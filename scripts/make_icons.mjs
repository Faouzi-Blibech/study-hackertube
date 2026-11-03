// Generates the extension icons: a red rounded square with a white "S". No dependencies.
// Run: node scripts/make_icons.mjs   (writes src/extension/icons/icon{16,32,48,128}.png)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '../src/extension/icons');
const RED = [211, 47, 47];
const SS = 4; // supersampling per axis

function arc(cx, cy, r, from, to, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
const sPath = [...arc(0.5, 0.365, 0.15, -20, -270), ...arc(0.5, 0.665, 0.15, -90, 160)];

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}
function inS(x, y, half) {
  for (let i = 0; i + 1 < sPath.length; i++) if (distToSegment(x, y, sPath[i], sPath[i + 1]) <= half) return true;
  return false;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        if (inRoundedSquare(x, y, 0.22)) { bg++; if (inS(x, y, 0.045)) fg++; }
      }
      const n = SS * SS, o = py * (size * 4 + 1) + 1 + px * 4;
      const white = bg ? fg / bg : 0;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(RED[c] * (1 - white) + 255 * white);
      raw[o + 3] = Math.round((bg / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(resolve(outDir, `icon${size}.png`), render(size));
console.log('icons written to', outDir);
