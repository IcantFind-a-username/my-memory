#!/usr/bin/env node
// Draws the 64x64 app icon (a white sprout on green) as a PNG with no dependencies.
// Used by the Claude extension and the ChatGPT app listing (which asks for 64x64, under 5 KB).

import fs from 'node:fs';
import zlib from 'node:zlib';

const N = 64;
const px = new Uint8Array(N * N * 4);
const set = (x, y, [r, g, b, a]) => {
  const i = (y * N + x) * 4;
  px.set([r, g, b, a], i);
};
const GREEN = [63, 111, 90, 255];
const WHITE = [255, 253, 248, 255];

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // rounded square background
    const cx = Math.min(Math.max(x, 12), N - 13);
    const cy = Math.min(Math.max(y, 12), N - 13);
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= 12 ** 2;
    set(x, y, inside ? GREEN : [0, 0, 0, 0]);
    if (!inside) continue;
    // stem
    if (Math.abs(x - 32) <= 1.5 && y >= 30 && y <= 50) set(x, y, WHITE);
    // leaves: two rotated ellipses
    const leaf = (ox, oy, ang) => {
      const dx = x - ox;
      const dy = y - oy;
      const u = dx * Math.cos(ang) + dy * Math.sin(ang);
      const v = -dx * Math.sin(ang) + dy * Math.cos(ang);
      return (u / 11) ** 2 + (v / 5.5) ** 2 <= 1;
    };
    if (leaf(23, 26, -0.6) || leaf(41, 22, 0.6)) set(x, y, WHITE);
    // ground
    if (y >= 49 && y <= 51 && x >= 20 && x <= 44) set(x, y, WHITE);
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(new URL('../packaging/icon.png', import.meta.url), png);
console.log(`packaging/icon.png ${png.length} bytes`);
