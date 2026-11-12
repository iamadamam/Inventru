'use strict';
/*
 * InventruServer.exe
 *
 *   Double-click   First time: installs (Windows asks for permission), starts, opens the setup page.
 *                  Already installed: opens the setup page.  Newer version: updates, keeps the data.
 *
 * For IT (asks for administrator permission by itself when needed):
 *   --install [--port N] [--dry-run]   --uninstall [--dry-run]   --status   --export FILE   --import FILE
 *   --run   run in this window (no install)        --data DIR   data folder (default C:\ProgramData\inventrustock-server)
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFile, execFileSync } = require('child_process');
const { createServer, VERSION, APP_ID } = require('./server');
const { readJson, writeJsonAtomic } = require('../src/core/jsonfile');

let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }

const HELP = `Inventru server ${VERSION}

  Double-click        install (first time) / open the setup page / update to this version

  For IT (Windows asks for administrator permission when needed):
  --install [--port N] [--dry-run]    install or update without opening the browser
  --uninstall [--dry-run]             remove the server (the stock data is kept)
  --status                            is it running?
  --export FILE / --import FILE       CSV backup / restore (server stopped, as administrator)
  --run                               run in this window, no install
  --data DIR                          data folder (default C:\\ProgramData\\inventrustock-server)
`;
const WIN = process.platform === 'win32';
const TASK = 'Inventru server';   // Task Scheduler task
const RULE = 'Inventru server';   // Windows Firewall rule
const FOLDER = 'inventrustock-server';
const EXE_NAME = 'InventruServer.exe';

/** C:\Program Files, read from the registry (not from environment variables, which a user can change). */
function programFiles() {
  if (!WIN) return path.join(os.homedir(), 'Programs');
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion', '/v', 'ProgramFilesDir'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /ProgramFilesDir\s+REG_\w+\s+(.+)/.exec(out);
    if (m && path.isAbsolute(m[1].trim())) return m[1].trim();
  } catch { /* fall back below */ }
  return process.env.ProgramFiles || 'C:\\Program Files';
}
const INSTALL_DIR = path.join(programFiles(), FOLDER);
const INSTALLED_EXE = path.join(INSTALL_DIR, EXE_NAME);
const defaultDataDir = () => (WIN ? path.join(process.env.ProgramData || 'C:\\ProgramData', FOLDER) : path.join(os.homedir(), `.${FOLDER}`));

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--?/, '');
    if (['port', 'data', 'import', 'export'].includes(k)) a[k] = argv[++i]; else a[k] = true;
  }
  return a;
}

function getAsset(name) {
  if (sea) { try { return sea.getAsset(name, 'utf8'); } catch { return null; } }
  const p = name === 'icons.js' ? path.join(__dirname, '..', 'src', 'renderer', 'icons.js') : path.join(__dirname, 'web', name);
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function makeLogger(dataDir) {
  const file = path.join(dataDir, 'server.log');
  return (...m) => {
    const line = `${new Date().toISOString()} ${m.join(' ')}`;
    console.log(line);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${line}\n`);
    } catch { /* ignore */ }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '0.0.0.0');
});
async function health(port, ms = 1500) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(ms) }); const j = await r.json(); return j.app === APP_ID ? j : null; } catch { return null; }
}
/** The port in server.json - null if there is none or this user can't read it (the data folder is for administrators). */
const savedPort = (dataDir) => { try { return Number(JSON.parse(fs.readFileSync(path.join(dataDir, 'server.json'), 'utf8')).port) || null; } catch { return null; } };
const cfgPort = (dataDir) => savedPort(dataDir) || 8080;
/** The port the Inventru server answers on. The data folder is for administrators only, so others look for it. */
async function findPort(dataDir) {
  const known = savedPort(dataDir);
  if (known && (await health(known))) return known;
  for (let p = 8080; p < 8100; p++) if (p !== known && (await health(p, 700))) return p;
  return null;
}
async function waitForServer(dataDir, ms) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) { const p = await findPort(dataDir); if (p) return p; }
  return null;
}
/** Open a link in the default browser (Windows' own "open this URL" handler; nothing to quote). */
const openBrowser = (url) => { if (WIN) spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref(); };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
/** "1.2.0" newer than "1.10.0"? (compares the numbers, not the text) */
const newerThan = (a, b) => {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const sameFile = (a, b) => { try { const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); return h(a) === h(b); } catch { return false; } };
const taskExists = () => spawnSync('schtasks', ['/Query', '/TN', TASK], { stdio: 'ignore', windowsHide: true }).status === 0;
/** Running with administrator rights (elevated), or as SYSTEM? */
function isAdmin() {
  if (!WIN) return process.getuid && process.getuid() === 0;
  const r = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
  return /S-1-16-(12288|16384)\b/.test(r.stdout || '');
}

// ---------------------------------------------------------------- network check (shown on the setup page)
/** A network set to "Public" blocks the firewall rule, so nothing else can connect. */
function parseProfiles(out) {
  const warn = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const [cat, ...name] = line.trim().split('|');
    if (cat === 'Public') warn.push(`This server's network ("${name.join('|') || 'unknown'}") is set to Public, so the store-room PC and the TV can't connect. Change it to Private (Windows Settings > Network & internet > your network > Network profile type), or ask IT.`);
  }
  return warn;
}
const PROFILE_PS = ['-NoProfile', '-NonInteractive', '-Command', "Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory + '|' + $_.Name }"];
function networkWarningsNow() {
  if (!WIN) return [];
  try { return parseProfiles(spawnSync('powershell.exe', PROFILE_PS, { encoding: 'utf8', windowsHide: true, timeout: 15000 }).stdout); } catch { return []; }
}
function networkWarningsCached() {
  const c = { at: 0, list: [], busy: false };
  const refresh = () => {
    if (!WIN || c.busy) return;
    c.busy = true;
    execFile('powershell.exe', PROFILE_PS, { encoding: 'utf8', windowsHide: true, timeout: 15000 }, (err, out) => {
      c.busy = false; c.at = Date.now();
      if (!err) c.list = parseProfiles(out);
    });
  };
  refresh();
  return () => { if (Date.now() - c.at > 60000) refresh(); return c.list; };
}

// ---------------------------------------------------------------- running (with a small watchdog)
async function runWorker(args, dataDir) {
  const log = makeLogger(dataDir);
  let srv;
  try { srv = createServer({ dataDir, port: args.port ? Number(args.port) : undefined, getAsset, log, warnings: networkWarningsCached() }); } catch (e) {
    log(`Could not start: ${e.message}`); // e.g. data.json held by another program - the watchdog tries again
    process.exit(1);
  }
  let port;
  try { port = await srv.listen(); } catch (e) {
    log(`Could not use port ${srv.port}: ${e.message}`);
    process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
  }
  log(`Inventru server ${VERSION} "${srv.name}" on port ${port} - dashboard http://${os.hostname()}:${port}  data: ${dataDir}`);
  const stop = async (why) => { log(`stopping (${why})`); await srv.close(); process.exit(0); };
  process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
  // The watchdog that started this process has gone (e.g. the task was stopped for an update): stop too.
  if (process.send) process.on('disconnect', () => stop('watchdog gone'));
  process.on('uncaughtException', (e) => { log('uncaught', e.stack || e); process.exit(1); });
}

function supervise(dataDir) {
  const log = makeLogger(dataDir);
  let delay = 2000;
  const userArgs = process.argv.slice(sea ? 1 : 2).filter((x) => x !== '--worker');
  const childArgs = sea ? [...userArgs, '--worker'] : [process.argv[1], ...userArgs, '--worker'];
  const start = () => {
    const t0 = Date.now();
    const child = spawn(process.execPath, childArgs, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    const fwd = () => child.kill();
    process.once('SIGINT', fwd); process.once('SIGTERM', fwd);
    child.on('exit', (code) => {
      process.removeListener('SIGINT', fwd); process.removeListener('SIGTERM', fwd);
      if (code === 0 || code === 3) process.exit(code);
      if (Date.now() - t0 > 60000) delay = 2000;
      log(`server stopped unexpectedly (code ${code}); restarting in ${delay / 1000}s`);
      setTimeout(start, delay);
      delay = Math.min(60000, delay * 2);
    });
  };
  start();
}

// ---------------------------------------------------------------- install / uninstall (Windows, as Administrator)
function run(cmd, cmdArgs, dry, okCodes = [0]) {
  console.log(`> ${cmd} ${cmdArgs.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ')}`);
  if (dry) return '';
  try { return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) {
    if (okCodes.includes(e.status)) return '';
    throw new Error(`${cmd} failed: ${(e.stderr || e.stdout || e.message).toString().trim()}`);
  }
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function taskXml(exe, dataDir) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Inventru server: the stock list and the TV dashboard (${xmlEsc(exe)})</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEsc(exe)}</Command><Arguments>--run --data "${xmlEsc(dataDir)}"</Arguments></Exec></Actions>
</Task>`;
}

/** Stop the scheduled task and wait until the server has really gone (so its files and port are free). */
async function stopTask(port, dry) {
  run('schtasks', ['/End', '/TN', TASK], dry, [1]);
  if (dry) return;
  for (let i = 0; i < 30 && (await health(port, 700)); i++) await sleep(500);
  await sleep(500);
}

/** Copy, retrying for a while: Windows keeps an .exe locked for a moment after it stops. */
async function copyWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.copyFileSync(from, to); return; } catch (e) {
      if (i >= 40 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await sleep(500);
    }
  }
}

async function install(args, dataDir) {
  if (!WIN) throw new Error('Installing is for Windows.');
  const dry = !!args['dry-run'];
  if (!sea && !dry) throw new Error(`Install from ${EXE_NAME} (or add --dry-run to preview).`);
  if (args.port && !(Number.isInteger(Number(args.port)) && Number(args.port) > 0 && Number(args.port) < 65536)) throw new Error('--port must be a number from 1 to 65535');
  if (!dry && !isAdmin()) return elevateAndReport(['--install', ...(args.port ? ['--port', String(args.port)] : []), '--data', dataDir], 'install');
  console.log(`Installing Inventru server ${VERSION}\n  program: ${INSTALL_DIR}\n  data:    ${dataDir}\n`);
  const before = savedPort(dataDir);
  if (!dry && taskExists()) { console.log('Stopping the running server...'); await stopTask(before || 8080, false); }
  if (!dry) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    if (!samePath(process.execPath, INSTALLED_EXE)) await copyWithRetry(process.execPath, INSTALLED_EXE);
    fs.mkdirSync(dataDir, { recursive: true });
  }
  // data folder: owned by Administrators; only SYSTEM and Administrators can open it (it holds the paired-PC list).
  // Set on the folder itself; files in it (now and later) inherit exactly that.
  run('icacls', [dataDir, '/setowner', '*S-1-5-32-544', '/T', '/C', '/Q'], dry);
  run('icacls', [dataDir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q'], dry);
  if (dry || fs.readdirSync(dataDir).length) run('icacls', [path.join(dataDir, '*'), '/reset', '/T', '/C', '/Q'], dry);
  // port: as asked, else the one it already uses (an update keeps it), else the first free one from 8080
  let port = Number(args.port) || savedPort(dataDir) || before;
  if (!port) { port = 8080; if (!dry) for (let p = 8080; p < 8100; p++) if (await portFree(p)) { port = p; break; } }
  if (!dry) {
    const f = path.join(dataDir, 'server.json');
    writeJsonAtomic(f, { ...(readJson(f, {}) || {}), port });
  }
  run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE}`], dry, [1]);
  run('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${RULE}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${port}`, 'profile=domain,private', `program=${INSTALLED_EXE}`, `description=Inventru server: TV dashboard and store-room PCs (TCP ${port})`], dry);
  // start at boot as SYSTEM, no time limit, restart on failure. The task file is written in the protected program folder.
  const xmlFile = path.join(INSTALL_DIR, 'task.xml');
  if (dry) console.log(taskXml(INSTALLED_EXE, dataDir)); else fs.writeFileSync(xmlFile, Buffer.from(`\ufeff${taskXml(INSTALLED_EXE, dataDir)}`, 'utf16le'));
  try { run('schtasks', ['/Create', '/F', '/TN', TASK, '/XML', xmlFile], dry); } finally { if (!dry) fs.rmSync(xmlFile, { force: true }); }
  run('schtasks', ['/Run', '/TN', TASK], dry);
  if (!dry) {
    for (let i = 0; i < 40 && !(await health(port)); i++) await sleep(500);
    if (!(await health(port))) throw new Error(`Installed, but the server has not answered on port ${port} yet. See server.log in ${dataDir}.`);
    console.log(`\nInstalled and running on port ${port}.`);
    for (const w of networkWarningsNow()) console.log(`\n  ! ${w}`);
  }
}

async function uninstall(args, dataDir) {
  if (!WIN) throw new Error('Uninstalling is for Windows.');
  const dry = !!args['dry-run'];
  if (!dry && !isAdmin()) return elevateAndReport(['--uninstall', '--data', dataDir], 'uninstall');
  await stopTask(cfgPort(dataDir), dry);
  run('schtasks', ['/Delete', '/F', '/TN', TASK], dry, [1]);
  run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE}`], dry, [1]);
  console.log(`> remove ${INSTALL_DIR}`);
  if (!dry && fs.existsSync(INSTALL_DIR)) {
    if (process.execPath.toLowerCase().startsWith(INSTALL_DIR.toLowerCase() + path.sep)) {
      // running from that folder (so may the window that asked for permission be): delete it once they have closed
      // The delete runs as a hidden PowerShell started through WMI (Win32_Process.Create), so it is outside this
      // program's process tree and lives on after it - processes started more directly are closed along with an
      // elevated program. The script is passed encoded, so no quoting can break it.
      const dir = INSTALL_DIR.replace(/'/g, "''");
      const loop = `for ($i = 0; $i -lt 120; $i++) { Start-Sleep -Seconds 1; Remove-Item -LiteralPath '${dir}' -Recurse -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath '${dir}')) { break } }`;
      const encoded = Buffer.from(loop, 'utf16le').toString('base64');
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}' } | Out-Null`], { stdio: 'ignore', windowsHide: true });
    } else {
      for (let i = 0; ; i++) {
        try { fs.rmSync(INSTALL_DIR, { recursive: true, force: true }); break; } catch (e) { if (i >= 20) throw e; await sleep(500); }
      }
    }
  }
  console.log(`\nRemoved. The stock data is still in ${dataDir} - delete that folder to remove it too.`);
}

/**
 * Run this .exe again with administrator rights (Windows shows its permission prompt) and wait.
 * Returns its exit code; 1223 = the prompt was cancelled.
 */
function elevated(args) {
  const quoted = [...args, '--elevated'].map((x) => `'${String(x).replace(/'/g, "''")}'`).join(',');
  const ps = `try { $p = Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList ${quoted} -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit', windowsHide: true });
  return r.status;
}
function elevateAndReport(args, what) {
  console.log(`Windows will ask for administrator permission to ${what} the Inventru server...`);
  const code = elevated(args);
  if (code === 0) console.log(what === 'install' ? 'Done.' : 'Removed. The stock data is kept.');
  else if (code === 1223) console.log('Cancelled: Windows permission was not given.');
  else console.log(`Did not finish (code ${code}) - see the message in the window that opened.`);
  process.exitCode = code === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- double-click
async function doubleClick(dataDir) {
  console.log(`Inventru server ${VERSION}\n`);
  // Only administrators can put files in Program Files, so the program being there means it is installed.
  // (Windows won't show a SYSTEM task to a normal user, so the task can't be checked from here.)
  const installed = fs.existsSync(INSTALLED_EXE);
  let isUpdate = installed && !samePath(process.execPath, INSTALLED_EXE) && !sameFile(process.execPath, INSTALLED_EXE);
  if (isUpdate) { // never replace a newer server with an older copy (e.g. from an old zip)
    let current = null;
    try { current = execFileSync(INSTALLED_EXE, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).trim(); } catch { /* unknown: update */ }
    if (current && newerThan(current, VERSION)) { console.log(`A newer Inventru server (${current}) is already installed - keeping it.\n`); isUpdate = false; }
  }
  if (!installed || isUpdate) {
    console.log(isUpdate ? 'Updating the installed server (your stock data is kept).' : 'Setting up the server.');
    console.log('Windows will ask "Do you want to allow this app to make changes to your device?" - click Yes.\n');
    const code = elevated(['--install', '--data', dataDir]);
    if (code === 1223) { console.log('Not installed: Windows permission was not given. Double-click InventruServer again and click Yes.'); return waitForEnter(10 * 60000); }
    if (code !== 0) { console.log(`Installing did not finish (code ${code}). The reason was shown in the window that opened.`); return waitForEnter(10 * 60000); }
  }
  let port = await waitForServer(dataDir, 3000);
  if (!port) { spawnSync('schtasks', ['/Run', '/TN', TASK], { stdio: 'ignore', windowsHide: true }); port = await waitForServer(dataDir, 30000); }
  if (!port) {
    console.log('The Inventru server is installed but not running. Restart this computer, or ask IT to check the task "Inventru server" in Task Scheduler.');
    return waitForEnter(10 * 60000);
  }
  await showSetup(port);
  console.log('You can close this window - the server keeps running in the background.');
  return waitForEnter(15 * 60000);
}

/** Open the setup page, and print the same details here (for servers without a browser). */
async function showSetup(port) {
  openBrowser(`http://localhost:${port}/setup`);
  try {
    const i = await (await fetch(`http://127.0.0.1:${port}/api/setup/info`)).json();
    const code = i.pairing ? `${i.pairing.code.slice(0, 3)} ${i.pairing.code.slice(3)}` : '(open the setup page)';
    console.log(`
  Inventru server is running.

  TV / any browser:   ${i.tvUrl}
                      ${i.addresses.join('   ')}

  Store-room PC - in the app type:
     Server:          ${i.appAddress}
     Pairing code:    ${code}   (valid 30 minutes, for one PC)

  Setup page:         http://localhost:${port}/setup   (opened in your browser, if there is one)
`);
  } catch { console.log(`Setup page: http://localhost:${port}/setup`); }
  for (const w of networkWarningsNow()) console.log(`  ! ${w}\n`);
}

const waitForEnter = (ms) => new Promise((resolve) => {
  console.log('Press Enter to close.');
  const t = setTimeout(resolve, ms);
  try { process.stdin.resume(); process.stdin.once('data', () => { clearTimeout(t); resolve(); }); process.stdin.once('end', () => { clearTimeout(t); resolve(); }); } catch { clearTimeout(t); resolve(); }
}).then(() => { try { process.stdin.pause(); } catch { /* ignore */ } });

// ---------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(sea ? 1 : 2));
  const dataDir = path.resolve(args.data || defaultDataDir());
  if (args.help || args.h || args['?']) { console.log(HELP); return; }
  if (args.version) { console.log(VERSION); return; }
  if (args.worker) return runWorker(args, dataDir);
  if (args.run) return supervise(dataDir);
  // started by "Windows will ask for permission": show the outcome in this window before it closes
  const finish = async (fn) => {
    try { await fn(); if (args.elevated) await sleep(4000); } catch (e) {
      console.error(`\n${e.message || e}`);
      if (isAdmin()) { try { makeLogger(dataDir)(`${args.install ? 'install' : 'uninstall'} failed: ${e.message || e}`); } catch { /* no data folder */ } }
      process.exitCode = 1;
      if (args.elevated) await waitForEnter(10 * 60000);
    }
  };
  if (args.install) return finish(() => install(args, dataDir));
  if (args.uninstall) return finish(() => uninstall(args, dataDir));
  if (args.status) {
    const port = await findPort(dataDir);
    const h = port && (await health(port));
    console.log(h ? `Running: "${h.name}", ${h.items} items, version ${h.version}. Dashboard: http://${os.hostname()}:${port}` : 'Not running.');
    process.exitCode = h ? 0 : 1; return;
  }
  if (args.export || args.import) {
    const port = await findPort(dataDir);
    if (port) throw new Error(`The server is running - use the setup page (http://localhost:${port}/setup) to import, or to download a backup.`);
    const srv = createServer({ dataDir, port: 0, getAsset });
    if (args.export) { fs.writeFileSync(args.export, srv.exportCsv()); console.log(`Exported ${srv.state.rows.length} items to ${args.export}`); }
    else { const r = srv.importCsv(fs.readFileSync(args.import, 'utf8')); console.log(`Imported: ${r.added} added, ${r.updated} updated.`); }
    await srv.close(); return;
  }
  if (sea && WIN) return doubleClick(dataDir);
  return supervise(dataDir); // running from the source code: just run
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
