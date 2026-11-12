'use strict';
// Makes the zip to hand out: dist\Inventru-<version>.zip
//   Server (VM)/InventruServer.exe     Store-room PC/Inventru-Setup-<version>.exe
//   README.txt (opens in Notepad)  ABOUT.md  CHANGELOG.md  LICENSE  docs/IT.md  docs/import-template.csv
// Written here (standard zip, "/" in paths) so it needs no other tools. Usage: npm run package (after npm run dist)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
const zipFile = path.join(root, 'dist', `Inventru-${version}.zip`);
const files = {
  'Server (VM)/InventruServer.exe': 'dist-server/InventruServer.exe',
  [`Store-room PC/Inventru-Setup-${version}.exe`]: `dist/Inventru-Setup-${version}.exe`,
  'README.txt': 'README.md',
  'ABOUT.md': 'ABOUT.md',
  'CHANGELOG.md': 'CHANGELOG.md',
  LICENSE: 'LICENSE',
  'docs/IT.md': 'docs/IT.md',
  'docs/import-template.csv': 'docs/import-template.csv',
};

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

const out = fs.openSync(zipFile, 'w');
let offset = 0;
const write = (buf) => { fs.writeSync(out, buf); offset += buf.length; };
const central = [];
for (const [name, from] of Object.entries(files)) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) throw new Error(`missing ${from} - run "npm run dist" first`);
  const data = fs.readFileSync(src);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const { time, date } = dosTime(fs.statSync(src).mtime);
  const fname = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fname.length, 26);
  const at = offset;
  write(local); write(fname); write(packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(data.length, 24); c.writeUInt16LE(fname.length, 28); c.writeUInt32LE(at, 42);
  central.push(Buffer.concat([c, fname]));
}
const cdStart = offset;
for (const c of central) write(c);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
write(end);
fs.closeSync(out);
console.log(`made ${zipFile} (${(fs.statSync(zipFile).size / 1048576).toFixed(1)} MB)`);
