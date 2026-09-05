/**
 * Generates simple colorful PNG badge icons (64x64) without external deps.
 * CRC32 + IHDR/IDAT/IEND minimal writer.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "..", "assets", "awards");
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngRGBA(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = rowStart + 1 + x * 4;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
      raw[o + 3] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeBadge(file, colors) {
  const size = 64;
  const rgba = new Uint8Array(size * size * 4);
  const [r1, g1, b1] = hex(colors[0]);
  const [r2, g2, b2] = hex(colors[1]);
  const cx = 32;
  const cy = 32;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;
      if (dist > 30) {
        rgba[i + 3] = 0;
        continue;
      }
      const t = dist / 30;
      rgba[i] = Math.round(r1 * (1 - t) + r2 * t);
      rgba[i + 1] = Math.round(g1 * (1 - t) + g2 * t);
      rgba[i + 2] = Math.round(b1 * (1 - t) + b2 * t);
      rgba[i + 3] = dist > 28 ? Math.round(255 * (30 - dist) / 2) : 255;
      // star highlight
      if (Math.abs(dx) + Math.abs(dy) < 10 && dist < 12) {
        rgba[i] = Math.min(255, rgba[i] + 40);
        rgba[i + 1] = Math.min(255, rgba[i + 1] + 40);
        rgba[i + 2] = Math.min(255, rgba[i + 2] + 20);
      }
      // ring
      if (dist > 24 && dist < 28) {
        rgba[i] = 255;
        rgba[i + 1] = 200;
        rgba[i + 2] = 80;
      }
    }
  }
  fs.writeFileSync(path.join(OUT, file), pngRGBA(size, size, rgba));
}

const badges = [
  ["first_game.png", ["#e11d2e", "#7a0f18"]],
  ["games_10.png", ["#ffb347", "#c45c12"]],
  ["games_50.png", ["#f59e0b", "#92400e"]],
  ["games_100.png", ["#fbbf24", "#b45309"]],
  ["time_1h.png", ["#38bdf8", "#075985"]],
  ["time_10h.png", ["#0ea5e9", "#0c4a6e"]],
  ["time_50h.png", ["#0284c7", "#082f49"]],
  ["chatty_50.png", ["#a78bfa", "#5b21b6"]],
  ["chatty_200.png", ["#8b5cf6", "#4c1d95"]],
  ["social_5.png", ["#34d399", "#065f46"]],
  ["voter.png", ["#f472b6", "#9d174d"]],
  ["rating_100.png", ["#facc15", "#854d0e"]],
  ["rating_500.png", ["#eab308", "#713f12"]],
  ["rating_1000.png", ["#fde047", "#a16207"]],
  ["most_games_today.png", ["#fb7185", "#9f1239"]],
  ["most_time_today.png", ["#67e8f9", "#155e75"]],
  ["most_games_week.png", ["#fdba74", "#9a3412"]],
  ["most_time_week.png", ["#5eead4", "#115e59"]],
  ["most_games_year.png", ["#fca5a5", "#7f1d1d"]],
  ["most_time_year.png", ["#93c5fd", "#1e3a8a"]],
  ["top_rating_day.png", ["#fcd34d", "#92400e"]],
  ["night_owl.png", ["#6366f1", "#1e1b4b"]],
  ["early_bird.png", ["#fbbf24", "#ea580c"]],
  ["forum_starter.png", ["#c4b5fd", "#6d28d9"]],
];

for (const [file, colors] of badges) makeBadge(file, colors);
console.log(`Wrote ${badges.length} award PNGs to ${OUT}`);
