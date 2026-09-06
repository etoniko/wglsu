import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  UPLOADS_DIR,
  readJson,
  writeJson,
  nextCounter,
  saveUser,
} from "./store.js";
import { GAMES as SEED_GAMES } from "./games.js";

function gamesDir() {
  const d = path.join(DATA_DIR, "games");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function catalogPath() {
  return path.join(gamesDir(), "catalog.json");
}

export function pendingPath() {
  return path.join(gamesDir(), "pending.json");
}

export function ensureGameUploads() {
  for (const sub of ["game-covers", "game-videos"]) {
    fs.mkdirSync(path.join(UPLOADS_DIR, sub), { recursive: true });
  }
}

export function readCatalog() {
  return readJson(catalogPath(), []);
}

export function readPending() {
  return readJson(pendingPath(), []);
}

export async function writeCatalog(list) {
  await writeJson(catalogPath(), list);
}

export async function writePending(list) {
  await writeJson(pendingPath(), list);
}

/** Seed + одобренные пользовательские игры */
export function allGames() {
  const dyn = readCatalog().filter((g) => g && g.code && g.id);
  const ids = new Set(SEED_GAMES.map((g) => g.id));
  const codes = new Set(SEED_GAMES.map((g) => g.code));
  const extra = dyn.filter((g) => !ids.has(g.id) && !codes.has(g.code));
  return [...SEED_GAMES, ...extra];
}

export function findAnyGame(q) {
  if (!q) return null;
  const s = String(q).toLowerCase();
  const list = allGames();
  return (
    list.find((g) => g.code === s) ||
    list.find((g) => g.id === s) ||
    list.find((g) => String(g.name).toLowerCase() === s) ||
    list.find((g) => g.url === q) ||
    null
  );
}

export function isAdminUser(user) {
  if (!user) return false;
  return String(user.nick || "").toLowerCase() === "нико";
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "game";
}

function makeCode(id) {
  // короткий код: u + base36 id, до 8 символов
  const raw = "u" + Number(id).toString(36);
  return raw.slice(0, 8);
}

export function validateSubmissionInput({ name, url, zone, blurb }) {
  const n = String(name || "").trim();
  if (n.length < 2 || n.length > 40) return "Название: 2–40 символов";
  let u = String(url || "").trim();
  if (!/^https?:\/\/.+/i.test(u)) return "Ссылка должна начинаться с http:// или https://";
  if (u.length > 300) return "Ссылка слишком длинная";
  const z = String(zone || ".su").trim().slice(0, 8) || ".su";
  const b = String(blurb || "").trim().slice(0, 80);
  return { name: n, url: u, zone: z, blurb: b || "Игра сообщества" };
}

export async function createSubmission({
  user,
  name,
  url,
  zone,
  blurb,
  img,
  video,
  videoDuration,
}) {
  const parsed = validateSubmissionInput({ name, url, zone, blurb });
  if (typeof parsed === "string") {
    const err = new Error(parsed);
    err.status = 400;
    throw err;
  }
  if (!img) {
    const err = new Error("Нужно фото игры");
    err.status = 400;
    throw err;
  }
  if (!video) {
    const err = new Error("Нужно видео (до 15 секунд)");
    err.status = 400;
    throw err;
  }
  const dur = Number(videoDuration);
  if (!Number.isFinite(dur) || dur <= 0 || dur > 15.5) {
    const err = new Error("Видео должно быть не длиннее 15 секунд");
    err.status = 400;
    throw err;
  }

  const list = allGames();
  if (list.some((g) => g.url === parsed.url || g.name.toLowerCase() === parsed.name.toLowerCase())) {
    const err = new Error("Такая игра уже есть в каталоге");
    err.status = 400;
    throw err;
  }
  const pending = readPending();
  if (
    pending.some(
      (p) =>
        p.status === "pending" &&
        (p.url === parsed.url || String(p.name).toLowerCase() === parsed.name.toLowerCase())
    )
  ) {
    const err = new Error("Такая заявка уже на модерации");
    err.status = 400;
    throw err;
  }

  const id = await nextCounter("nextSubmissionId");
  const code = makeCode(id);
  const gameId = `user-${slugify(parsed.name)}-${id}`;
  const sub = {
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorId: user.id,
    authorNick: user.nick,
    code,
    gameId,
    name: parsed.name,
    url: parsed.url,
    zone: parsed.zone,
    blurb: parsed.blurb,
    img,
    video,
    videoDuration: Math.round(dur * 10) / 10,
    review: null,
  };
  pending.unshift(sub);
  await writePending(pending.slice(0, 500));
  return sub;
}

/** +1 голос всем (bonusVotes), без влияния на рейтинг */
export async function grantBonusVoteToAllUsers() {
  let n = 0;
  for (let shard = 0; shard < 256; shard++) {
    const dir = path.join(DATA_DIR, "users", String(shard));
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const user = readJson(path.join(dir, name), null);
      if (!user?.id) continue;
      if (!user.stats) user.stats = {};
      user.stats.bonusVotes = (Number(user.stats.bonusVotes) || 0) + 1;
      await saveUser(user);
      n += 1;
    }
  }
  return n;
}

export async function approveSubmission(subId, admin) {
  const pending = readPending();
  const idx = pending.findIndex((p) => Number(p.id) === Number(subId));
  if (idx < 0) {
    const err = new Error("Заявка не найдена");
    err.status = 404;
    throw err;
  }
  const sub = pending[idx];
  if (sub.status !== "pending") {
    const err = new Error("Заявка уже обработана");
    err.status = 400;
    throw err;
  }

  const game = {
    code: sub.code,
    id: sub.gameId,
    name: sub.name,
    url: sub.url,
    zone: sub.zone,
    video: sub.video,
    img: sub.img,
    blurb: sub.blurb,
    community: true,
    authorId: sub.authorId,
    authorNick: sub.authorNick,
    approvedAt: new Date().toISOString(),
  };

  const catalog = readCatalog();
  if (catalog.some((g) => g.id === game.id || g.code === game.code)) {
    const err = new Error("Игра уже в каталоге");
    err.status = 400;
    throw err;
  }
  catalog.push(game);
  await writeCatalog(catalog);

  sub.status = "approved";
  sub.updatedAt = new Date().toISOString();
  sub.review = {
    byId: admin.id,
    byNick: admin.nick,
    at: sub.updatedAt,
    note: "одобрено",
  };
  pending[idx] = sub;
  await writePending(pending);

  const granted = await grantBonusVoteToAllUsers();
  return { game, submission: sub, grantedUsers: granted };
}

export async function rejectSubmission(subId, admin, note) {
  const pending = readPending();
  const idx = pending.findIndex((p) => Number(p.id) === Number(subId));
  if (idx < 0) {
    const err = new Error("Заявка не найдена");
    err.status = 404;
    throw err;
  }
  const sub = pending[idx];
  if (sub.status !== "pending") {
    const err = new Error("Заявка уже обработана");
    err.status = 400;
    throw err;
  }
  sub.status = "rejected";
  sub.updatedAt = new Date().toISOString();
  sub.review = {
    byId: admin.id,
    byNick: admin.nick,
    at: sub.updatedAt,
    note: String(note || "отклонено").slice(0, 200),
  };
  pending[idx] = sub;
  await writePending(pending);
  return sub;
}

export function publicSubmission(sub, viewer) {
  if (!sub) return null;
  const mine = viewer && Number(viewer.id) === Number(sub.authorId);
  const admin = isAdminUser(viewer);
  return {
    id: sub.id,
    status: sub.status,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    authorId: sub.authorId,
    authorNick: sub.authorNick,
    name: sub.name,
    url: sub.url,
    zone: sub.zone,
    blurb: sub.blurb,
    img: sub.img,
    video: sub.video,
    videoDuration: sub.videoDuration,
    code: admin || mine || sub.status === "approved" ? sub.code : undefined,
    gameId: admin || mine || sub.status === "approved" ? sub.gameId : undefined,
    review: sub.review,
  };
}
