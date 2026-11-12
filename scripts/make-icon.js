'use strict';
// Draws the Inventru icon with no dependencies: a rounded blue square with a white "- +".
// Writes build/icon.ico (16-256 px, for both .exe files) and src/assets/icon.png (256 px, the window icon).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** RGBA pixels of the icon at size n (4x4 supersampled so small sizes stay crisp). */
function draw(n) {
  const S = 4; const k = 256 / (n * S);
  const px = Buffer.alloc(n * n * 4);
  const inRound = (x, y, r) => {
    const cx = Math.min(Math.max(x, r), 255 - r), cy = Math.min(Math.max(y, r), 255 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const bar = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const X = (x * S + sx + 0.5) * k, Y = (y * S + sy + 0.5) * k; // position on the 256 grid
          if (!inRound(X, Y, 56)) continue;
          const t = Y / 256;
          const glyph = bar(X, Y, 56, 120, 120, 136) || bar(X, Y, 150, 120, 214, 136) || bar(X, Y, 174, 96, 190, 160);
          const c = glyph ? [255, 255, 255] : [59 - 20 * t, 130 - 30 * t, 246 - 10 * t];
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const i = (y * n + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (255 * a) / (S * S); }
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(n, px) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Classic icon image: 32-bit BGRA bitmap, bottom-up, followed by the 1-bit AND mask. */
function dib(n, px) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(n, 4); head.writeInt32LE(n * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = (y * n + x) * 4, d = ((n - 1 - y) * n + x) * 4;
      pixels[d] = px[s + 2]; pixels[d + 1] = px[s + 1]; pixels[d + 2] = px[s]; pixels[d + 3] = px[s + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(n / 32) * 4 * n); // all 0: the alpha channel decides
  return Buffer.concat([head, pixels, mask]);
}

function ico(sizes) {
  const images = sizes.map((n) => { const px = draw(n); return { n, data: n >= 256 ? png(n, px) : dib(n, px) }; });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach(({ n, data }, i) => {
    const e = 6 + i * 16;
    dir[e] = n >= 256 ? 0 : n; dir[e + 1] = n >= 256 ? 0 : n;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...images.map((x) => x.data)]);
}

const root = path.join(__dirname, '..');
const write = (rel, buf) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); console.log('wrote', rel); };
write('src/assets/icon.png', png(256, draw(256)));
write('build/icon.ico', ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
