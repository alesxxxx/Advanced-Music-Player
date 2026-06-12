// Generates AMP's app/tray icons from code (no design tool / binary asset to commit-by-hand):
//   build/icon.ico   — electron-builder app + installer + exe icon (multi-size)
//   build/icon.png   — 256px, general/Linux use
//   electron/trayIconData.ts — base64 PNG embedded for the runtime Tray (no file-path lookup)
//
// Design: a warm off-white rounded square (AMP's accent) with a dark play triangle — reads as a
// music player at any size. Rendered 4x-supersampled for clean anti-aliased edges.

import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SS = 4; // supersampling factor

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Standard rounded-box signed distance (<= 0 means inside).
function roundedBoxSdf(px, py, size) {
  const margin = size * 0.075;
  const r = size * 0.235;
  const center = size / 2;
  const halfX = (size - 2 * margin) / 2;
  const halfY = (size - 2 * margin) / 2;
  const dx = Math.abs(px - center) - (halfX - r);
  const dy = Math.abs(py - center) - (halfY - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

// Right-pointing play triangle, optically centred.
function insidePlayTriangle(px, py, size) {
  const ax = size * 0.4;
  const ay = size * 0.31;
  const bx = size * 0.4;
  const by = size * 0.69;
  const cx = size * 0.69;
  const cy = size * 0.5;
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sampleColor(px, py, size) {
  const sdf = roundedBoxSdf(px, py, size);
  if (sdf > 0) {
    return [0, 0, 0, 0];
  }
  if (insidePlayTriangle(px, py, size)) {
    return [12, 12, 13, 255]; // --shell
  }
  // Warm accent vertical gradient (#f1ede3 -> #d8d2c4).
  const t = py / size;
  return [Math.round(lerp(241, 216, t)), Math.round(lerp(237, 210, t)), Math.round(lerp(227, 196, t)), 255];
}

function renderRgba(size) {
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const [sr, sg, sb, sa] = sampleColor(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          // Premultiply so transparent edges don't darken.
          const af = sa / 255;
          r += sr * af;
          g += sg * af;
          b += sb * af;
          a += sa;
        }
      }
      const samples = SS * SS;
      const alpha = a / samples;
      const offset = (y * size + x) * 4;
      if (alpha <= 0) {
        buffer[offset] = buffer[offset + 1] = buffer[offset + 2] = buffer[offset + 3] = 0;
      } else {
        const af = a / 255;
        buffer[offset] = Math.round(r / af);
        buffer[offset + 1] = Math.round(g / af);
        buffer[offset + 2] = Math.round(b / af);
        buffer[offset + 3] = Math.round(alpha);
      }
    }
  }
  return buffer;
}

// --- PNG encoder ---
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Prefix each scanline with filter byte 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// --- ICO writer (embeds PNGs; valid on Windows Vista+) ---
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const buildDir = path.join(desktopRoot, "build");
await fs.mkdir(buildDir, { recursive: true });

const icoSizes = [16, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map((size) => ({ size, data: encodePng(renderRgba(size), size) }));
await fs.writeFile(path.join(buildDir, "icon.ico"), encodeIco(icoPngs));

const png256 = icoPngs.find((p) => p.size === 256).data;
await fs.writeFile(path.join(buildDir, "icon.png"), png256);

const trayPng = encodePng(renderRgba(32), 32);
const trayDataUrl = `data:image/png;base64,${trayPng.toString("base64")}`;
const appDataUrl = `data:image/png;base64,${png256.toString("base64")}`;
await fs.writeFile(
  path.join(desktopRoot, "electron", "trayIconData.ts"),
  `// AUTO-GENERATED by scripts/generate-icons.mjs — do not edit by hand.\n` +
    `// AMP glyphs embedded as data URLs so the Tray + window icon need no runtime file lookup.\n` +
    `export const trayIconDataUrl =\n  "${trayDataUrl}";\n\n` +
    `export const appIconDataUrl =\n  "${appDataUrl}";\n`
);

console.log(
  `[icons] wrote build/icon.ico (${icoSizes.join(",")}), build/icon.png (256), electron/trayIconData.ts (tray ${trayPng.length}B, app ${png256.length}B)`
);
