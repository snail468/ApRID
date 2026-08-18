// One-shot PWA icon generator — no native deps (ImageMagick/sharp aren't available
// on all dev hosts). Rasterizes a white airplane on the brand-blue background into
// PNGs via a tiny pure-JS PNG encoder (zlib + CRC32). Re-run with `npm run icons`.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRAND = [0x4f, 0x7c, 0xff];   // --accent
const WHITE = [0xff, 0xff, 0xff];

// airplane silhouette in a 0..1 box (pointing up), built from a symmetric right half
const RIGHT = [
  [0.50, 0.07], [0.55, 0.34], [0.95, 0.58], [0.95, 0.635], [0.565, 0.50],
  [0.55, 0.73], [0.74, 0.88], [0.74, 0.925], [0.535, 0.80], [0.50, 0.93],
];
function planePolygon() {
  const pts = [...RIGHT];
  for (let i = RIGHT.length - 2; i >= 1; i--) pts.push([1 - RIGHT[i][0], RIGHT[i][1]]);
  return pts;
}
const PLANE = planePolygon();

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// rounded-rect coverage test in pixel space
function inRoundRect(px, py, size, radius) {
  const r = radius;
  const x = Math.min(Math.max(px, r), size - r);
  const y = Math.min(Math.max(py, r), size - r);
  if (px >= r && px <= size - r) return py >= 0 && py <= size;
  if (py >= r && py <= size - r) return px >= 0 && px <= size;
  const dx = px - x, dy = py - y;
  return dx * dx + dy * dy <= r * r;
}

function render(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  // maskable icons must keep content within the central 80% safe zone
  const inset = maskable ? size * 0.19 : size * 0.10;
  const box = size - inset * 2;
  const SS = 3; // supersampling grid per pixel for anti-aliasing
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, plane = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          if (inRoundRect(fx, fy, size, radius)) bg++;
          const nx = (fx - inset) / box, ny = (fy - inset) / box;
          if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 && pointInPoly(nx, ny, PLANE)) plane++;
        }
      }
      const n = SS * SS;
      const bgA = bg / n, planeA = plane / n;
      // composite: brand bg (with alpha for rounded corners), white plane on top
      const r = WHITE[0] * planeA + BRAND[0] * (1 - planeA);
      const g = WHITE[1] * planeA + BRAND[1] * (1 - planeA);
      const b = WHITE[2] * planeA + BRAND[2] * (1 - planeA);
      const a = Math.max(bgA, planeA); // plane never extends past bg here, but be safe
      const o = (py * size + px) * 4;
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g); buf[o + 2] = Math.round(b);
      buf[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(buf, size, size);
}

// ---- minimal PNG encoder (RGBA, filter 0) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- SVG (crisp scalable icon for modern browsers) ----
function svg() {
  const d = 'M ' + PLANE.map(([x, y]) => `${(x * 100).toFixed(1)} ${(y * 100).toFixed(1)}`).join(' L ') + ' Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#4f7cff"/>
  <g transform="translate(10 10) scale(0.8)"><path d="${d}" fill="#fff"/></g>
</svg>\n`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), render(192, { maskable: false }));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), render(512, { maskable: false }));
fs.writeFileSync(path.join(OUT, 'maskable-512.png'), render(512, { maskable: true }));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), render(180, { maskable: false }));
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg());
console.log('icons written to', OUT);
