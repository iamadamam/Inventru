'use strict';
/*
 * Checks the finished programs (not the source code):
 *   dist\win-unpacked\Inventru.exe       name/version/icon, locked-down Electron fuses, no demo mode, works with a real
 *                                        server and with "Just this PC"
 *   dist-server\InventruServer.exe       name/version, NODE_OPTIONS ignored, serves the setup page + dashboard, watchdog
 * Usage: npm run test:release   (after electron-builder and build:server; "npm run dist" does all of it)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { readFuses } = require('./after-pack');
const { runServerE2E } = require('./e2e-server');
const { runLocalE2E } = require('./e2e-local');
const { launch, freePort, sleep } = require('./cdp');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');
const appExe = path.join(root, 'dist', 'win-unpacked', 'Inventru.exe');
const serverExe = path.join(root, 'dist-server', 'InventruServer.exe');
const setupExe = path.join(root, 'dist', `Inventru-Setup-${pkg.version}.exe`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inventru-release-'));
let failed = 0;
const line = (ok, name, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  -  ${detail}` : ''}`); };
const versionInfo = (f) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${f}').VersionInfo | Select-Object FileDescription,ProductName,CompanyName,FileVersion,ProductVersion | ConvertTo-Json`], { encoding: 'utf8' }));
const env = () => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; delete e.NODE_OPTIONS; return e; };

async function app() {
  console.log('\nInventru.exe (the app)');
  for (const f of [appExe, setupExe]) line(fs.existsSync(f), `${path.basename(f)} built`, `${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
  const v = versionInfo(appExe);
  line(v.FileDescription === 'Inventru' && v.ProductName === 'Inventru' && v.CompanyName === 'Inventru' && v.FileVersion.startsWith(pkg.version), 'shows as "Inventru" in Task Manager and file Properties', `${v.FileDescription} / ${v.CompanyName} / ${v.FileVersion}`);
  const fuses = readFuses(appExe);
  line(fuses.RunAsNode === '0' && fuses.EnableNodeOptionsEnvironmentVariable === '0' && fuses.EnableNodeCliInspectArguments === '0' && fuses.OnlyLoadAppFromAsar === '1', 'Electron features it never uses are switched off', JSON.stringify(fuses));

  // ELECTRON_RUN_AS_NODE must not turn it into a general script runner
  const marker = path.join(tmp, 'ran-as-node.txt');
  const p = spawn(appExe, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`, `--user-data-dir=${path.join(tmp, 'runasnode')}`], { env: { ...env(), ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
  await sleep(6000);
  try { spawnSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }); } catch { /* gone */ }
  line(!fs.existsSync(marker), 'ELECTRON_RUN_AS_NODE cannot run scripts with it');

  // the app's files are checked against the checksum inside Inventru.exe: a changed file stops it starting
  const copy = path.join(tmp, 'tampered');
  fs.cpSync(path.dirname(appExe), copy, { recursive: true });
  const asar = path.join(copy, 'resources', 'app.asar');
  const buf = fs.readFileSync(asar);
  const at = buf.indexOf(Buffer.from('Inventru app (store-room PC)'));
  buf[at] = 'X'.charCodeAt(0);
  fs.writeFileSync(asar, buf);
  const tampered = spawnSync(path.join(copy, 'Inventru.exe'), [`--user-data-dir=${path.join(tmp, 'tampered-data')}`], { timeout: 15000, env: env(), stdio: 'ignore' });
  const startedAnyway = tampered.error && tampered.error.code === 'ETIMEDOUT';
  if (startedAnyway) spawnSync('taskkill', ['/F', '/IM', 'Inventru.exe', '/FI', `MODULES eq Inventru.exe`], { stdio: 'ignore' });
  line(at > 0 && !startedAnyway, 'a changed app file stops it from starting (integrity check)', `exit code ${tampered.status}`);

  // demo mode is for developers only: the installed app always uses a real server
  const demo = await launch(appExe, ['--demo', `--user-data-dir=${path.join(tmp, 'demo')}`], { env: env(), ready: 'document.readyState === "complete" && !!window.api' });
  line(await demo.waitFor('!document.getElementById("connect").hidden', 8000), '--demo is ignored by the installed app (it asks for a server)');
  await demo.close();

  // the real thing: pair with a server, change stock, see another PC's change
  for (const r of await runServerE2E(appExe)) line(r.ok, `with a real server: ${r.name}`, r.detail);
  // and without one: "Just this PC"
  for (const r of await runLocalE2E(appExe)) line(r.ok, `just this PC: ${r.name}`, r.detail);
}

async function server() {
  console.log('\nInventruServer.exe (the server)');
  const v = versionInfo(serverExe);
  line(v.FileDescription === 'Inventru server' && v.ProductName === 'Inventru' && v.FileVersion === pkg.version, 'shows as "Inventru server" in Task Manager and file Properties', `${v.FileDescription} / ${v.FileVersion}`);
  line(execFileSync(serverExe, ['--version'], { encoding: 'utf8', env: env() }).trim() === pkg.version, '--version');
  const inject = path.join(tmp, 'inject.js');
  fs.writeFileSync(inject, "console.log('INJECTED')");
  const out = execFileSync(serverExe, ['--version'], { encoding: 'utf8', env: { ...env(), NODE_OPTIONS: `--require=${inject}` } });
  line(!out.includes('INJECTED'), 'NODE_OPTIONS cannot inject code into it');
  const dry = execFileSync(serverExe, ['--install', '--dry-run', '--data', path.join(tmp, 'dry')], { encoding: 'utf8', env: env() });
  line(/inventrustock-server\\InventruServer\.exe/.test(dry) && /schtasks \/Create/.test(dry) && /setowner/.test(dry) && /profile=domain,private/.test(dry), '--install --dry-run lists the changes it would make');

  const port = await freePort();
  const data = path.join(tmp, 'server-data');
  const sup = spawn(serverExe, ['--run', '--data', data, '--port', String(port)], { env: env(), stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let h = null;
  for (let i = 0; i < 40 && !h; i++) { await sleep(250); h = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null); }
  line(h && h.app === 'inventru-server' && h.version === pkg.version, 'starts and answers', h && `${h.app} ${h.version}`);
  const setup = await fetch(`${base}/setup`);
  const html = await setup.text();
  line(setup.status === 200 && /Inventru server is running/.test(html) && !/\{\{[A-Z_]+\}\}/.test(html) && /form-action 'self'/.test(setup.headers.get('content-security-policy')), 'setup page complete (pages are inside the .exe)');
  const dash = await fetch(`${base}/`);
  line(dash.status === 200 && /Inventru/.test(await dash.text()), 'TV dashboard');
  for (const f of ['/dashboard.js', '/dashboard.css', '/icons.js', '/setup.js', '/setup.css', '/favicon.svg']) {
    const r = await fetch(base + f); if (r.status !== 200) line(false, `serves ${f}`, String(r.status));
  }
  // the watchdog: stopping it (as Task Scheduler does) stops the server too, so updates can replace the file
  const kids = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${sup.pid}").ProcessId`], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  spawnSync('taskkill', ['/F', '/PID', String(sup.pid)], { stdio: 'ignore' });
  await sleep(2500);
  const alive = kids.filter((pid) => spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).stdout.includes(pid));
  line(kids.length === 1 && alive.length === 0, 'the server stops when its watchdog is stopped', `worker ${kids.join(',')} ${alive.length ? 'still running' : 'stopped'}`);
  line(fs.readFileSync(path.join(data, 'server.log'), 'utf8').includes(`Inventru server ${pkg.version}`), 'writes server.log in its data folder');
}

(async () => {
  const t0 = Date.now();
  if (process.platform !== 'win32') { console.log('Windows only.'); return; }
  await server();
  await app();
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
