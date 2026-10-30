/**
 * Generates the neutral brand PNGs from the same geometric design as
 * public/favicon.svg (stacked layers = slices): favicon fallback, Apple
 * touch icon, PWA icons and the OG wordmark. Self-made, no Mojang assets.
 *
 * Dependency-free on purpose: a ~60-line PNG encoder (node:zlib) plus a
 * 5x7 pixel font for the seven letters of "mcslicer". Run via
 * `npm run gen:brand`; outputs in public/ are committed so builds and
 * deploys never need to regenerate them.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Palette mirrors the app theme (index.html :root).
const BG = [16, 18, 24, 255]; // #101218 page background
const PANEL = [20, 22, 29, 255]; // #14161d icon plate
const LINE = [35, 38, 46, 255]; // #23262e plate border
const ACCENT = [61, 125, 255, 255]; // #3d7dff
const MID = [139, 148, 163, 255]; // #8b94a3
const LOW = [51, 58, 72, 255]; // #333a48
const TEXT = [213, 218, 226, 255]; // #d5dae2

// ---- minimal PNG encoder (8-bit RGBA, no filters) --------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(pngChunk('IHDR', ihdr)),
    Buffer.from(pngChunk('IDAT', deflateSync(raw, { level: 9 }))),
    Buffer.from(pngChunk('IEND', new Uint8Array(0))),
  ]);
}

// ---- tiny raster ------------------------------------------------------
interface Img {
  width: number;
  height: number;
  data: Uint8Array;
}

function img(width: number, height: number, fill: readonly number[]): Img {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

function putPixel(im: Img, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || y < 0 || x >= im.width || y >= im.height) return;
  im.data.set(color, (y * im.width + x) * 4);
}

/** Signed-distance rounded rectangle, antialias-free (pixel font aesthetic). */
function roundRect(im: Img, x: number, y: number, w: number, h: number, r: number, color: readonly number[]): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const qx = Math.abs(px + 0.5 - (x + w / 2)) - (w / 2 - r);
      const qy = Math.abs(py + 0.5 - (y + h / 2)) - (h / 2 - r);
      const dist = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      if (dist <= 0) putPixel(im, px, py, color);
    }
  }
}

// ---- 5x7 pixel font: only the letters of "mcslicer" -------------------
const FONT: Record<string, string[]> = {
  m: ['00000', '00000', '11010', '10101', '10101', '10001', '10001'],
  c: ['00000', '00000', '01110', '10001', '10000', '10001', '01110'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
  l: ['00110', '00100', '00100', '00100', '00100', '00100', '01110'],
  i: ['00100', '00000', '00100', '00100', '00100', '00100', '00100'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01111'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
};

function drawText(im: Img, text: string, x: number, y: number, scale: number, color: readonly number[]): void {
  let cursor = x;
  for (const ch of text) {
    const glyph = FONT[ch];
    if (!glyph) throw new Error(`glyph missing: ${ch}`);
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            putPixel(im, cursor + gx * scale + sx, y + gy * scale + sy, color);
          }
        }
      }
    });
    cursor += 6 * scale; // 5 glyph columns + 1 gap column
  }
}

/** The stacked-layers motif shared with public/favicon.svg. */
function drawLayers(im: Img, cx: number, top: number, width: number, barH: number, gap: number): void {
  const x = Math.round(cx - width / 2);
  roundRect(im, x, top, width, barH, barH / 4, ACCENT);
  roundRect(im, x, top + barH + gap, width, barH, barH / 4, MID);
  roundRect(im, x, top + 2 * (barH + gap), width, barH, barH / 4, LOW);
}

function appIcon(size: number): Img {
  const im = img(size, size, BG);
  const r = Math.round(size * 0.22);
  const bw = Math.max(2, Math.round(size / 40));
  roundRect(im, 0, 0, size, size, r, LINE);
  roundRect(im, bw, bw, size - 2 * bw, size - 2 * bw, Math.max(r - bw, 1), PANEL);
  const barH = Math.round(size * 0.125);
  drawLayers(im, size / 2, Math.round(size * 0.19), Math.round(size * 0.56), barH, Math.round(size * 0.055));
  return im;
}

function touchIcon(size: number): Img {
  const im = img(size, size, BG);
  const barH = Math.round(size * 0.135);
  drawLayers(im, size / 2, Math.round(size * 0.21), Math.round(size * 0.6), barH, Math.round(size * 0.06));
  return im;
}

function ogImage(): Img {
  const W = 1200;
  const H = 630;
  const im = img(W, H, BG);
  // plate echoing the app panels, with a thin border ring
  roundRect(im, 90, 70, W - 180, H - 140, 36, LINE);
  roundRect(im, 94, 74, W - 188, H - 148, 33, PANEL);
  drawLayers(im, W / 2, 140, 180, 40, 18);
  // wordmark: "mc" in text color + "slicer" in accent, as in the app header
  const scale = 13;
  const wordW = (7 * 6 - 1) * scale; // 7 glyphs, gap after every one but the last
  let x = Math.round(W / 2 - wordW / 2);
  const y = 420;
  for (const [part, color] of [['mc', TEXT], ['slicer', ACCENT]] as const) {
    drawText(im, part, x, y, scale, color);
    x += part.length * 6 * scale;
  }
  return im;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const outputs: Array<[string, Img]> = [
  ['favicon-32.png', appIcon(32)],
  ['apple-touch-icon.png', touchIcon(180)],
  ['icon-192.png', appIcon(192)],
  ['icon-512.png', appIcon(512)],
  ['og-image.png', ogImage()],
];
for (const [name, im] of outputs) {
  writeFileSync(join(outDir, name), encodePng(im.width, im.height, im.data));
  console.log(`${name}: ${im.width}x${im.height}`);
}
