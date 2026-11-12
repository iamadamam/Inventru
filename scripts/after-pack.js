'use strict';
/*
 * electron-builder "afterPack" step: switch off the Electron features this app never uses, in the packed Inventru.exe
 * (Electron "fuses" - https://www.electronjs.org/docs/latest/tutorial/fuses). Each fuse is one byte after a marker in
 * the .exe: '1' on, '0' off. Done here without extra packages. Also run by test-release.js to check the result.
 */
const fs = require('fs');
const path = require('path');

const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
// position in the fuse wire (version 1) -> wanted value
const WANT = {
  0: ['RunAsNode', '0'],                            // the .exe can't be used as a general Node.js (ELECTRON_RUN_AS_NODE)
  1: ['EnableCookieEncryption', '1'],               // cookies (none are used) encrypted at rest
  2: ['EnableNodeOptionsEnvironmentVariable', '0'], // NODE_OPTIONS can't inject code
  3: ['EnableNodeCliInspectArguments', '0'],        // --inspect can't attach a debugger to the app's background process
  4: ['EnableEmbeddedAsarIntegrityValidation', '1'], // the app's files must match the checksum built into Inventru.exe
  5: ['OnlyLoadAppFromAsar', '1'],                  // only the app packed with it can run
  // 7 GrantFileProtocolExtraPrivileges stays on: Electron needs it to read the window's files from app.asar.
  // Instead, main.js lets the window load only the app's own files.
};

function locate(buf) {
  const at = buf.indexOf(SENTINEL);
  if (at < 0 || buf.indexOf(SENTINEL, at + 1) >= 0) throw new Error('Electron fuse marker not found exactly once');
  const p = at + SENTINEL.length;
  if (buf[p] !== 1) throw new Error(`unknown Electron fuse wire version ${buf[p]}`);
  return { start: p + 2, length: buf[p + 1] };
}

/** -> { RunAsNode: '0', ... } */
function readFuses(exe) {
  const buf = fs.readFileSync(exe);
  const { start, length } = locate(buf);
  const out = {};
  for (const [i, [name]] of Object.entries(WANT)) if (Number(i) < length) out[name] = String.fromCharCode(buf[start + Number(i)]);
  return out;
}

function setFuses(exe) {
  const buf = fs.readFileSync(exe);
  const { start, length } = locate(buf);
  for (const [i, [, v]] of Object.entries(WANT)) {
    if (Number(i) >= length) throw new Error(`fuse ${i} missing`);
    if (buf[start + Number(i)] !== 0x72) buf[start + Number(i)] = v.charCodeAt(0); // 'r' = removed in this Electron
  }
  fs.writeFileSync(exe, buf);
  return readFuses(exe);
}

module.exports = async function afterPack(context) {
  const exes = fs.readdirSync(context.appOutDir).filter((f) => /\.exe$/i.test(f));
  if (exes.length !== 1) throw new Error(`expected one .exe in ${context.appOutDir}, found: ${exes.join(', ')}`);
  const exe = path.join(context.appOutDir, exes[0]);
  const fuses = setFuses(exe);
  console.log(`  • fuses set in ${path.basename(exe)}: ${Object.entries(fuses).map(([k, v]) => `${k}=${v}`).join(' ')}`);
};
module.exports.readFuses = readFuses;
module.exports.WANT = WANT;
