/**
 * PNG badges for gifts (same minimal writer as awards).
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "..", "assets", "gifts");
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
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeGift(file, c1, c2, shape = "heart") {
  const size = 72;
  const rgba = new Uint8Array(size * size * 4);
  const [r1, g1, b1] = hex(c1);
  const [r2, g2, b2] = hex(c2);
  const cx = 36;
  const cy = 36;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / 28;
      const dy = (y - cy) / 28;
      const i = (y * size + x) * 4;
      let inside = false;
      if (shape === "heart") {
        const a = dx;
        const b = dy - 0.15;
        inside = Math.pow(a * a + b * b - 1, 3) - a * a * b * b * b < 0;
      } else if (shape === "star") {
        const ang = Math.atan2(dy, dx);
        const r = Math.sqrt(dx * dx + dy * dy);
        const spike = 0.55 + 0.35 * Math.cos(ang * 5);
        inside = r < spike;
      } else if (shape === "gem") {
        inside = Math.abs(dx) + Math.abs(dy) < 0.85 && Math.abs(dy) < 0.7;
      } else {
        inside = dx * dx + dy * dy < 0.85;
      }
      if (!inside) {
        rgba[i + 3] = 0;
        continue;
      }
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      rgba[i] = Math.round(r1 * (1 - t) + r2 * t);
      rgba[i + 1] = Math.round(g1 * (1 - t) + g2 * t);
      rgba[i + 2] = Math.round(b1 * (1 - t) + b2 * t);
      rgba[i + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(OUT, file), pngRGBA(size, size, rgba));
}

makeGift("bear_hug.png", "#ffb347", "#e11d2e", "heart");
makeGift("gold_star.png", "#fde047", "#b45309", "star");
makeGift("fire_pack.png", "#fb7185", "#9f1239", "circle");
makeGift("crown.png", "#fbbf24", "#92400e", "star");
makeGift("diamond.png", "#67e8f9", "#0e7490", "gem");
console.log("gifts written to", OUT);
