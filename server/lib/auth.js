import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import {
  loadUser,
  saveUser,
  nextCounter,
  updateNickIndex,
  findIdByNick,
  updateRatingIndex,
  sessionPath,
  sessionsDir,
  readJson,
  writeJson,
  publicUser,
} from "./store.js";
import { calcRating } from "./rating.js";

export const MAX_SESSIONS = 2;

function userSessionIndexPath(userId) {
  const dir = path.join(sessionsDir(), "by-user");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${userId}.json`);
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function checkPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function validateNick(nick) {
  if (typeof nick !== "string") return "Ник обязателен";
  const n = nick.trim();
  if (n.length < 3 || n.length > 20) return "Ник: 3–20 символов";
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-]+$/.test(n)) return "Ник: буквы, цифры, _ и -";
  return null;
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 72) {
    return "Пароль: 6–72 символа";
  }
  return null;
}

export async function registerUser({ nick, password }) {
  const nickErr = validateNick(nick);
  if (nickErr) throw Object.assign(new Error(nickErr), { status: 400 });
  const passErr = validatePassword(password);
  if (passErr) throw Object.assign(new Error(passErr), { status: 400 });

  const clean = nick.trim();
  if (findIdByNick(clean)) {
    throw Object.assign(new Error("Ник уже занят"), { status: 409 });
  }

  const id = await nextCounter("nextUserId");
  const user = {
    id,
    nick: clean,
    passHash: hashPassword(password),
    avatar: null,
    registeredAt: new Date().toISOString(),
    rating: 0,
    stats: {
      gamesPlayed: 0,
      messages: 0,
      totalPlayMs: 0,
      byGame: {},
    },
    friends: [],
    friendRequestsIn: [],
    friendRequestsOut: [],
    awards: [],
    votes: {},
    giftsReceived: [],
    giftsSent: [],
    freeGiftsLeft: 1,
    lastActions: {},
  };
  user.rating = calcRating(user);
  await saveUser(user);
  await updateNickIndex(clean, id);
  await updateRatingIndex(user);
  return user;
}

export async function loginUser({ nick, password }) {
  const id = findIdByNick((nick || "").trim());
  if (!id) throw Object.assign(new Error("Неверный ник или пароль"), { status: 401 });
  const user = loadUser(id);
  if (!user || !checkPassword(password, user.passHash)) {
    throw Object.assign(new Error("Неверный ник или пароль"), { status: 401 });
  }
  return user;
}

export function listUserSessions(userId) {
  const tokens = readJson(userSessionIndexPath(userId), []);
  const alive = [];
  const keep = [];
  for (const t of tokens) {
    const s = readJson(sessionPath(t), null);
    if (s && s.userId === userId) {
      alive.push(s);
      keep.push(t);
    }
  }
  if (keep.length !== tokens.length) {
    writeJson(userSessionIndexPath(userId), keep).catch(() => {});
  }
  return alive;
}

export async function createSession(user, meta = {}) {
  const sessions = listUserSessions(user.id);
  if (sessions.length >= MAX_SESSIONS) {
    const err = new Error(
      "Уже открыто 2 сеанса. Выйдите с одного устройства или вкладки, чтобы войти снова."
    );
    err.status = 403;
    err.code = "SESSION_LIMIT";
    err.sessions = sessions.map((s) => ({
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
      ua: (s.ua || "").slice(0, 80),
      ip: s.ip || "",
    }));
    throw err;
  }

  const token = makeToken();
  const session = {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ua: meta.ua || "",
    ip: meta.ip || "",
  };
  await writeJson(sessionPath(token), session);
  const tokens = sessions.map((s) => s.token);
  tokens.push(token);
  await writeJson(userSessionIndexPath(user.id), tokens);
  return session;
}

export function getSession(token) {
  if (!token || token.length < 16) return null;
  return readJson(sessionPath(token), null);
}

export async function touchSession(token) {
  const s = getSession(token);
  if (!s) return null;
  s.lastSeen = new Date().toISOString();
  await writeJson(sessionPath(token), s);
  return s;
}

export async function destroySession(token) {
  const s = getSession(token);
  if (!s) return;
  try {
    fs.unlinkSync(sessionPath(token));
  } catch {
    /* ignore */
  }
  const idxFile = userSessionIndexPath(s.userId);
  const tokens = readJson(idxFile, []).filter((t) => t !== token);
  await writeJson(idxFile, tokens);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers["x-session-token"] || "";
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Нужен вход в личный кабинет" });
  }
  const user = loadUser(session.userId);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Пользователь не найден" });
  }
  req.token = token;
  req.session = session;
  req.user = user;
  touchSession(token).catch(() => {});
  next();
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : req.headers["x-session-token"] || "";
  const session = getSession(token);
  if (session) {
    const user = loadUser(session.userId);
    if (user) {
      req.token = token;
      req.session = session;
      req.user = user;
      touchSession(token).catch(() => {});
    }
  }
  next();
}

export { publicUser };
