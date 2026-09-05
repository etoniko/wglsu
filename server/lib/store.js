import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Runtime JSON/store — never inside the public web root (GitHub-safe). */
const defaultRoot = path.join(os.homedir(), ".wgl-cabinet");
export const DATA_DIR =
  process.env.WGL_DATA_DIR || path.join(defaultRoot, "data");
export const UPLOADS_DIR =
  process.env.WGL_UPLOADS_DIR || path.join(defaultRoot, "uploads");

const writeQueues = new Map();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function initStore() {
  for (const d of [
    DATA_DIR,
    path.join(DATA_DIR, "users"),
    path.join(DATA_DIR, "indexes"),
    path.join(DATA_DIR, "sessions"),
    path.join(DATA_DIR, "chat"),
    path.join(DATA_DIR, "chat", "games"),
    path.join(DATA_DIR, "dm"),
    path.join(DATA_DIR, "dm", "index"),
    path.join(DATA_DIR, "forum"),
    path.join(DATA_DIR, "votes"),
    path.join(DATA_DIR, "meta"),
    path.join(UPLOADS_DIR, "avatars"),
  ]) {
    ensureDir(d);
  }

  // 256 shards for ~100k users (~400/file max if packed; we use 1 file/user)
  for (let i = 0; i < 256; i++) {
    ensureDir(path.join(DATA_DIR, "users", String(i)));
  }

  const metaPath = path.join(DATA_DIR, "meta", "counters.json");
  if (!fs.existsSync(metaPath)) {
    writeJsonSync(metaPath, { nextUserId: 1, nextThreadId: 1, nextPostId: 1 });
  }
  const nickIdx = path.join(DATA_DIR, "indexes", "nicks.json");
  if (!fs.existsSync(nickIdx)) writeJsonSync(nickIdx, {});
  const ratingIdx = path.join(DATA_DIR, "indexes", "rating.json");
  if (!fs.existsSync(ratingIdx)) writeJsonSync(ratingIdx, []);
  const gameVotes = path.join(DATA_DIR, "votes", "games.json");
  if (!fs.existsSync(gameVotes)) writeJsonSync(gameVotes, {});
  const awardsState = path.join(DATA_DIR, "meta", "awards-state.json");
  if (!fs.existsSync(awardsState)) writeJsonSync(awardsState, { lastDaily: "", lastWeekly: "", lastYearly: "" });
}

function writeJsonSync(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0), "utf8");
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  const key = file;
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(() => {
    writeJsonSync(file, data);
  }).catch(() => {
    writeJsonSync(file, data);
  });
  writeQueues.set(key, next);
  return next;
}

export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

export function readJsonlTail(file, maxLines = 200) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return [];
  const lines = raw.trim().split("\n");
  const slice = lines.slice(-maxLines);
  const out = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

export function userShard(id) {
  return String(Number(id) % 256);
}

export function userPath(id) {
  return path.join(DATA_DIR, "users", userShard(id), `${id}.json`);
}

export function loadUser(id) {
  return readJson(userPath(id), null);
}

export async function saveUser(user) {
  await writeJson(userPath(user.id), user);
}

export async function nextCounter(key) {
  const file = path.join(DATA_DIR, "meta", "counters.json");
  const counters = readJson(file, { nextUserId: 1, nextThreadId: 1, nextPostId: 1 });
  const val = counters[key] || 1;
  counters[key] = val + 1;
  await writeJson(file, counters);
  return val;
}

export function nickIndexPath() {
  return path.join(DATA_DIR, "indexes", "nicks.json");
}

export function ratingIndexPath() {
  return path.join(DATA_DIR, "indexes", "rating.json");
}

export function sessionsDir() {
  return path.join(DATA_DIR, "sessions");
}

export function sessionPath(token) {
  // shard sessions by first 2 chars of token hash-ish
  const shard = token.slice(0, 2);
  ensureDir(path.join(sessionsDir(), shard));
  return path.join(sessionsDir(), shard, `${token}.json`);
}

export async function updateNickIndex(nick, id, remove = false) {
  const file = nickIndexPath();
  const idx = readJson(file, {});
  const key = nick.toLowerCase();
  if (remove) delete idx[key];
  else idx[key] = id;
  await writeJson(file, idx);
}

export function findIdByNick(nick) {
  const idx = readJson(nickIndexPath(), {});
  return idx[nick.toLowerCase()] || null;
}

export async function updateRatingIndex(user) {
  const file = ratingIndexPath();
  let list = readJson(file, []);
  list = list.filter((x) => x.id !== user.id);
  list.push({
    id: user.id,
    nick: user.nick,
    rating: user.rating || 0,
    avatar: user.avatar || DEFAULT_AVATAR,
  });
  list.sort((a, b) => b.rating - a.rating || a.id - b.id);
  if (list.length > 5000) list = list.slice(0, 5000);
  await writeJson(file, list);
}

/** Remove a user id from the rating board (e.g. after id migration). */
export async function removeFromRatingIndex(userId) {
  const file = ratingIndexPath();
  const list = readJson(file, []).filter((x) => x.id !== userId);
  await writeJson(file, list);
}

/** Walk all user shards and rebuild rating board (after formula change). */
export async function rebuildRatingBoard(calcFn) {
  const board = [];
  for (let shard = 0; shard < 256; shard++) {
    const dir = path.join(DATA_DIR, "users", String(shard));
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const user = readJson(path.join(dir, name), null);
      if (!user?.id) continue;
      user.rating = calcFn(user);
      writeJsonSync(userPath(user.id), user);
      board.push({
        id: user.id,
        nick: user.nick,
        rating: user.rating || 0,
        avatar: user.avatar || DEFAULT_AVATAR,
      });
    }
  }
  board.sort((a, b) => b.rating - a.rating || a.id - b.id);
  await writeJson(ratingIndexPath(), board.slice(0, 5000));
  return board.length;
}

export const DEFAULT_AVATAR = "/assets/default-avatar.png";

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nick: user.nick,
    avatar: user.avatar || DEFAULT_AVATAR,
    registeredAt: user.registeredAt,
    rating: user.rating || 0,
    stats: user.stats,
    awards: user.awards || [],
    friendsCount: (user.friends || []).length,
  };
}
