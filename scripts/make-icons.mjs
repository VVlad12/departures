// Draws the app icons (a clock over a departure board line) without any dependency: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const NAVY = [11, 34, 64];
const YELLOW = [255, 196, 37];
const WHITE = [244, 246, 250];

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distance from point p to segment a-b, in unit coordinates.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Colour at a point of the unit square, or null for transparent. `inset` shrinks the art for maskable icons.
function shade(x, y, full, inset) {
  if (!full) {
    const r = 0.2, qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (Math.hypot(qx, qy) > r) return null;
  }
  const u = 0.5 + (x - 0.5) / inset, v = 0.5 + (y - 0.5) / inset;
  const cx = 0.5, cy = 0.44, d = Math.hypot(u - cx, v - cy);
  if (d < 0.27) {
    if (segDist(u, v, cx, cy, cx, cy - 0.17) < 0.028 || segDist(u, v, cx, cy, cx + 0.12, cy + 0.04) < 0.028) return NAVY;
    return d < 0.035 ? NAVY : YELLOW;
  }
  if (Math.abs(v - 0.83) < 0.025 && Math.abs(u - 0.5) < 0.3) return WHITE;
  return NAVY;
}

function draw(size, full, inset) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = shade((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, full, inset);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const i = (y * size + x) * 4;
      if (a) { out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a; out[i + 3] = (255 * a) / (S * S); }
    }
  }
  return png(size, out);
}

const dir = new URL('../icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', dir), draw(192, false, 1));
writeFileSync(new URL('icon-512.png', dir), draw(512, false, 1));
writeFileSync(new URL('maskable-512.png', dir), draw(512, true, 0.8));
console.log('icons written');
