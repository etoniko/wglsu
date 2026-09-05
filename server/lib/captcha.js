import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR, readJson, writeJson } from "./store.js";

const captchaFile = () => path.join(DATA_DIR, "meta", "captchas.json");
const TTL_MS = 5 * 60 * 1000;

function load() {
  return readJson(captchaFile(), {});
}

async function save(map) {
  await writeJson(captchaFile(), map);
}

function prune(map) {
  const now = Date.now();
  for (const [id, row] of Object.entries(map)) {
    if (!row || row.exp < now || row.used) delete map[id];
  }
  return map;
}

/** Exclude ambiguous chars: 0OIl1 */
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += CHARS[crypto.randomInt(0, CHARS.length)];
  }
  return s;
}

function hashAnswer(code) {
  return crypto.createHash("sha256").update(String(code).toUpperCase()).digest("hex");
}

/** Distorted SVG captcha — hard for simple OCR bots */
export function renderCaptchaSvg(code) {
  const w = 220;
  const h = 72;
  const noise = [];
  for (let i = 0; i < 18; i++) {
    const x1 = crypto.randomInt(0, w);
    const y1 = crypto.randomInt(0, h);
    const x2 = crypto.randomInt(0, w);
    const y2 = crypto.randomInt(0, h);
    const c = `rgba(${crypto.randomInt(80, 200)},${crypto.randomInt(40, 120)},${crypto.randomInt(40, 100)},0.45)`;
    noise.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${1 + crypto.randomInt(0, 2)}"/>`);
  }
  for (let i = 0; i < 40; i++) {
    noise.push(
      `<circle cx="${crypto.randomInt(0, w)}" cy="${crypto.randomInt(0, h)}" r="${crypto.randomInt(1, 2)}" fill="rgba(255,180,80,0.35)"/>`
    );
  }

  const letters = [...code].map((ch, i) => {
    const x = 28 + i * 36 + crypto.randomInt(-4, 5);
    const y = 44 + crypto.randomInt(-8, 9);
    const rot = crypto.randomInt(-28, 29);
    const size = 28 + crypto.randomInt(0, 8);
    const fill = i % 2 === 0 ? "#f3ebe3" : "#ffb347";
    return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="Georgia, serif" font-weight="700" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
  });

  // decoy glyphs bots might read
  const decoys = [];
  for (let i = 0; i < 3; i++) {
    const x = crypto.randomInt(10, w - 10);
    const y = crypto.randomInt(14, h - 10);
    decoys.push(
      `<text x="${x}" y="${y}" fill="rgba(243,235,227,0.18)" font-size="14" transform="rotate(${crypto.randomInt(-40, 40)} ${x} ${y})">${CHARS[crypto.randomInt(0, CHARS.length)]}</text>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a100c"/>
      <stop offset="100%" stop-color="#321f16"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="10" fill="url(#g)"/>
  <path d="M0,${20 + crypto.randomInt(0, 20)} Q${w / 2},${crypto.randomInt(10, 60)} ${w},${20 + crypto.randomInt(0, 30)}" fill="none" stroke="rgba(225,29,46,0.35)" stroke-width="2"/>
  ${noise.join("")}
  ${decoys.join("")}
  ${letters.join("")}
</svg>`;
}

export async function createCaptcha() {
  let map = prune(load());
  const id = crypto.randomBytes(16).toString("hex");
  const code = randomCode(5);
  map[id] = {
    hash: hashAnswer(code),
    exp: Date.now() + TTL_MS,
    used: false,
    created: Date.now(),
  };
  // keep map small
  const keys = Object.keys(map);
  if (keys.length > 2000) {
    keys.slice(0, keys.length - 1500).forEach((k) => delete map[k]);
  }
  await save(map);
  const svg = renderCaptchaSvg(code);
  return {
    id,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    expiresIn: TTL_MS,
  };
}

export async function verifyCaptcha(id, answer) {
  if (!id || answer === undefined || answer === null) {
    const err = new Error("Введите капчу");
    err.status = 400;
    throw err;
  }
  let map = prune(load());
  const row = map[id];
  if (!row || row.used || row.exp < Date.now()) {
    const err = new Error("Капча устарела — обновите картинку");
    err.status = 400;
    throw err;
  }
  const ok = row.hash === hashAnswer(String(answer).trim());
  row.used = true;
  delete map[id];
  await save(map);
  if (!ok) {
    const err = new Error("Неверная капча");
    err.status = 400;
    throw err;
  }
  return true;
}

/** Extra bot friction: honeypot + timing */
export function verifyBotTraps(body) {
  // honeypot fields must stay empty
  if (body.website || body.company || body.fax) {
    const err = new Error("Регистрация отклонена");
    err.status = 400;
    throw err;
  }
  const t0 = Number(body.t0 || body.captchaStarted);
  if (!t0 || Date.now() - t0 < 2500) {
    const err = new Error("Слишком быстро. Подождите и введите капчу ещё раз.");
    err.status = 400;
    throw err;
  }
  if (Date.now() - t0 > 15 * 60 * 1000) {
    const err = new Error("Сессия регистрации устарела — обновите страницу");
    err.status = 400;
    throw err;
  }
}
