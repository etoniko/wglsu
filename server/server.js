import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import { WebSocketServer } from "ws";

import {
  initStore,
  loadUser,
  saveUser,
  publicUser,
  findIdByNick,
  readJson,
  writeJson,
  appendJsonl,
  readJsonlTail,
  DATA_DIR,
  UPLOADS_DIR,
  updateRatingIndex,
  ratingIndexPath,
  nextCounter,
  DEFAULT_AVATAR,
  rebuildRatingBoard,
} from "./lib/store.js";
import {
  registerUser,
  loginUser,
  createSession,
  destroySession,
  authMiddleware,
  optionalAuth,
  listUserSessions,
  MAX_SESSIONS,
} from "./lib/auth.js";
import {
  limitIp,
  limitUserAction,
  limitUserCount,
  LIMITS,
} from "./lib/limits.js";
import { calcRating, formatPlayTime } from "./lib/rating.js";
import {
  AWARD_DEFS,
  awardsPublicList,
  checkAutoAwards,
  recordActivity,
  runPeriodAwards,
} from "./lib/awards.js";
import { createCaptcha, verifyCaptcha, verifyBotTraps } from "./lib/captcha.js";
import {
  normalizeUserVotes,
  voteSummary,
  votesUsed,
  voteBudget,
} from "./lib/votes.js";
import { GAMES, findGame, playPath } from "./lib/games.js";
import {
  globalChatPath,
  gameChatPath,
  dmPath,
  dmIndexPath,
  readChatTail,
  writeChat,
} from "./lib/chat.js";
import { giftsCatalog, getGift, freeGiftsLeft } from "./lib/gifts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3847;

initStore();

const app = express();
app.set("trust proxy", 1);

const ALLOWED_ORIGINS = new Set([
  "https://wgl.su",
  "http://wgl.su",
  "https://www.wgl.su",
  "http://www.wgl.su",
  "https://etoniko.github.io",
  "http://etoniko.github.io",
  "https://sixz.ru",
  "http://sixz.ru",
  "http://localhost:6020",
  "http://127.0.0.1:6020",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "256kb" }));

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.socket.remoteAddress || "";
}

function votesPath() {
  return path.join(DATA_DIR, "votes", "games.json");
}

function forumIndexPath() {
  return path.join(DATA_DIR, "forum", "threads.json");
}

function enrichAwards(user) {
  const map = Object.fromEntries(AWARD_DEFS.map((a) => [a.id, a]));
  return (user.awards || []).map((a) => ({
    ...a,
    title: map[a.id]?.title || a.id,
    desc: map[a.id]?.desc || "",
    icon: `/assets/awards/${map[a.id]?.icon || "first_game.png"}`,
  }));
}

function getRatingBoard() {
  return readJson(ratingIndexPath(), []);
}

/** Место в таблице (1 = топ-1). null если игрока нет в индексе. */
function getRatingPlace(userId) {
  const list = getRatingBoard();
  const idx = list.findIndex((x) => x.id === Number(userId));
  return idx >= 0 ? idx + 1 : null;
}

function profilePayload(user, viewer = null) {
  const pub = publicUser(user);
  pub.awards = enrichAwards(user);
  pub.giftsReceived = (user.giftsReceived || []).slice(-50);
  pub.freeGiftsLeft = freeGiftsLeft(user);
  pub.profileUrl = `/id${user.id}`;
  pub.place = getRatingPlace(user.id);
  pub.statsFormatted = {
    totalPlay: formatPlayTime(user.stats?.totalPlayMs || 0),
    byGame: Object.entries(user.stats?.byGame || {}).map(([name, g]) => ({
      name,
      sessions: g.sessions || 0,
      playTime: formatPlayTime(g.playMs || 0),
      playMs: g.playMs || 0,
      lastPlayed: g.lastPlayed || null,
    })),
  };
  if (viewer && viewer.id === user.id) {
    pub.friends = user.friends || [];
    pub.friendRequestsIn = user.friendRequestsIn || [];
    pub.friendRequestsOut = user.friendRequestsOut || [];
    pub.votes = normalizeUserVotes(user.votes);
    pub.voteBudget = voteSummary(user);
    pub.giftsSent = user.giftsSent || [];
    pub.isSelf = true;
  } else if (viewer) {
    pub.isFriend = (viewer.friends || []).includes(user.id);
    pub.requestOut = (viewer.friendRequestsOut || []).includes(user.id);
    pub.requestIn = (viewer.friendRequestsIn || []).includes(user.id);
  }
  return pub;
}

// ——— Auth ———
app.get("/api/captcha", async (req, res) => {
  try {
    limitIp(clientIp(req), "captcha", LIMITS.captchaPerIp.max, LIMITS.captchaPerIp.windowMs);
    const captcha = await createCaptcha();
    res.json({ ok: true, ...captcha, t0: Date.now() });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    limitIp(clientIp(req), "register", LIMITS.registerPerIp.max, LIMITS.registerPerIp.windowMs);
    verifyBotTraps(req.body);
    await verifyCaptcha(req.body.captchaId, req.body.captcha);
    const user = await registerUser({ nick: req.body.nick, password: req.body.password });
    const session = await createSession(user, { ua: req.headers["user-agent"], ip: clientIp(req) });
    res.json({ ok: true, token: session.token, user: profilePayload(user, user) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code, sessions: e.sessions });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    limitIp(clientIp(req), "login", LIMITS.loginPerIp.max, LIMITS.loginPerIp.windowMs);
    const user = await loginUser({ nick: req.body.nick, password: req.body.password });
    const session = await createSession(user, { ua: req.headers["user-agent"], ip: clientIp(req) });
    res.json({ ok: true, token: session.token, user: profilePayload(user, user), maxSessions: MAX_SESSIONS });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code, sessions: e.sessions });
  }
});

app.post("/api/logout", authMiddleware, async (req, res) => {
  await destroySession(req.token);
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = loadUser(req.user.id);
  res.json({
    ok: true,
    user: profilePayload(user, user),
    sessions: listUserSessions(user.id).map((s) => ({
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
      ua: (s.ua || "").slice(0, 80),
      current: s.token === req.token,
    })),
  });
});

// ——— Avatar ———
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(UPLOADS_DIR, "avatars")),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".png").toLowerCase().slice(0, 5);
    const safe = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".png";
    cb(null, `${req.user.id}${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error("Только изображения PNG/JPG/WEBP/GIF"));
    }
    cb(null, true);
  },
});

app.post("/api/avatar", authMiddleware, (req, res) => {
  upload.single("avatar")(req, res, async (err) => {
    try {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? "Файл слишком большой — максимум 5 МБ"
            : err.message || "Ошибка загрузки";
        return res.status(400).json({ ok: false, error: msg });
      }
      if (!req.file) return res.status(400).json({ ok: false, error: "Файл не получен" });
      const user = loadUser(req.user.id);
      limitUserAction(user, "avatar", LIMITS.avatarMinInterval);
      user.avatar = `/uploads/avatars/${req.file.filename}?t=${Date.now()}`;
      await saveUser(user);
      await updateRatingIndex(user);
      res.json({ ok: true, user: profilePayload(user, user) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });
});

// ——— Games + votes ———
function rebuildGameList(votes, myVotes = null) {
  return GAMES.map((g) => ({
    ...g,
    play: playPath(g),
    score: Math.max(0, Number(votes[g.id]?.score) || 0),
    myVotes: myVotes ? Number(myVotes[g.id] || 0) : undefined,
  })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
}

app.get("/api/games", optionalAuth, (req, res) => {
  const votes = readJson(votesPath(), {});
  const myVotes = req.user ? normalizeUserVotes(req.user.votes) : null;
  const payload = { ok: true, games: rebuildGameList(votes, myVotes) };
  if (req.user) payload.voteBudget = voteSummary(req.user);
  res.json(payload);
});

/** amount = абсолютное; action=klass → +1 «класс», при полном бюджете −1 с другой карточки */
app.post("/api/games/:id/vote", authMiddleware, async (req, res) => {
  try {
    const game = findGame(req.params.id) || GAMES.find((g) => g.id === req.params.id);
    if (!game) return res.status(404).json({ ok: false, error: "Игра не найдена" });

    const user = loadUser(req.user.id);
    limitUserAction(user, "vote", LIMITS.voteMinInterval);

    const budget = voteBudget(user);
    const before = normalizeUserVotes(user.votes);
    const current = { ...before };
    const prev = current[game.id] || 0;
    const isKlass = String(req.body.action || "") === "klass" || req.body.klass === true;

    if (isKlass) {
      if (budget <= 0) {
        return res.status(400).json({
          ok: false,
          error: "Нет голосов. Сыграй игры под ЛК — 1 игра = 1 «класс».",
          voteBudget: voteSummary(user),
        });
      }
      if (votesUsed(current) >= budget) {
        let donorId = null;
        let donorN = 0;
        for (const [id, n] of Object.entries(current)) {
          if (id === game.id) continue;
          if (n > donorN) {
            donorN = n;
            donorId = id;
          }
        }
        if (!donorId) {
          return res.status(400).json({
            ok: false,
            error: "Все «классы» уже на этой карточке",
            voteBudget: voteSummary(user),
          });
        }
        if (donorN <= 1) delete current[donorId];
        else current[donorId] = donorN - 1;
      }
      current[game.id] = prev + 1;
    } else {
      const amount = Math.floor(Number(req.body.amount ?? req.body.value));
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ ok: false, error: "Укажите число голосов (≥ 0)" });
      }
      const usedOther = votesUsed(current) - prev;
      if (usedOther + amount > budget) {
        return res.status(400).json({
          ok: false,
          error: `Недостаточно голосов. Доступно: ${Math.max(0, budget - usedOther)}`,
          voteBudget: voteSummary(user),
        });
      }
      if (amount === 0) delete current[game.id];
      else current[game.id] = amount;
    }

    const votes = readJson(votesPath(), {});
    const ids = new Set([...Object.keys(before), ...Object.keys(current)]);
    for (const id of ids) {
      const delta = (current[id] || 0) - (before[id] || 0);
      if (!delta) continue;
      if (!votes[id]) votes[id] = { score: 0 };
      votes[id].score = Math.max(0, (Number(votes[id].score) || 0) + delta);
    }

    user.votes = current;
    await writeJson(votesPath(), votes);
    await checkAutoAwards(user);
    await saveUser(user);

    res.json({
      ok: true,
      games: rebuildGameList(votes, current),
      myVotes: current[game.id] || 0,
      voteBudget: voteSummary(user),
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

/** Вернуть все голоса с карточек обратно игроку */
app.post("/api/votes/reset", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "voteReset", 3000);
    const current = normalizeUserVotes(user.votes);
    const votes = readJson(votesPath(), {});
    for (const [id, n] of Object.entries(current)) {
      if (!votes[id]) continue;
      votes[id].score = Math.max(0, (Number(votes[id].score) || 0) - n);
    }
    user.votes = {};
    await writeJson(votesPath(), votes);
    await saveUser(user);
    res.json({
      ok: true,
      games: rebuildGameList(votes, {}),
      voteBudget: voteSummary(user),
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ——— Play tracking ———
app.post("/api/play/start", authMiddleware, async (req, res) => {
  try {
    const gameId = req.body.gameId || req.body.game;
    const game = findGame(gameId) || findGame(req.body.url);
    if (!game) return res.status(400).json({ ok: false, error: "Неизвестная игра" });

    const user = loadUser(req.user.id);
    if (!user.stats.byGame[game.name]) {
      user.stats.byGame[game.name] = { sessions: 0, playMs: 0, lastPlayed: null };
    }
    user.stats.byGame[game.name].sessions += 1;
    user.stats.byGame[game.name].lastPlayed = new Date().toISOString();
    user.stats.gamesPlayed += 1;
    const before = user.rating;
    user.rating = calcRating(user);
    await recordActivity(user.id, { games: 1, ratingDelta: user.rating - before });
    await checkAutoAwards(user);
    await saveUser(user);
    await updateRatingIndex(user);
    res.json({ ok: true, game: game.name, user: profilePayload(user, user) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/play/heartbeat", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "heartbeat", LIMITS.playHeartbeatMin);

    const gameName = req.body.game || req.body.gameName;
    const game = findGame(gameName);
    if (!game) return res.status(400).json({ ok: false, error: "Неизвестная игра" });

    let delta = Number(req.body.deltaMs) || LIMITS.playHeartbeatMin;
    delta = Math.min(Math.max(delta, 0), LIMITS.playHeartbeatMaxCredit);

    if (!user.stats.byGame[game.name]) {
      user.stats.byGame[game.name] = { sessions: 0, playMs: 0, lastPlayed: null };
    }
    user.stats.byGame[game.name].playMs += delta;
    user.stats.byGame[game.name].lastPlayed = new Date().toISOString();
    user.stats.totalPlayMs += delta;
    const before = user.rating;
    user.rating = calcRating(user);
    await recordActivity(user.id, { playMs: delta, ratingDelta: user.rating - before });
    await checkAutoAwards(user);
    await saveUser(user);
    await updateRatingIndex(user);
    res.json({ ok: true, creditedMs: delta, rating: user.rating });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ——— Friends ———
app.get("/api/friends/search", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "search", LIMITS.searchMinInterval);
    await saveUser(user);

    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ ok: true, results: [] });

    const results = [];
    const rating = readJson(ratingIndexPath(), []);

    if (/^\d+$/.test(q)) {
      const u = loadUser(Number(q));
      if (u) results.push(publicUser(u));
    }

    const byNick = findIdByNick(q);
    if (byNick) {
      const u = loadUser(byNick);
      if (u && !results.some((r) => r.id === u.id)) results.push(publicUser(u));
    }

    const ql = q.toLowerCase();
    for (const row of rating) {
      if (results.length >= 20) break;
      if (String(row.nick).toLowerCase().includes(ql) || String(row.rating) === q || String(row.id) === q) {
        if (!results.some((r) => r.id === row.id)) {
          results.push({ id: row.id, nick: row.nick, rating: row.rating, avatar: row.avatar });
        }
      }
    }

    res.json({ ok: true, results: results.filter((r) => r.id !== user.id).slice(0, 20) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/friends/request", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "friendReq", LIMITS.friendReqMinInterval);
    limitUserCount(
      user,
      "friendReq",
      LIMITS.friendReqPerDay,
      24 * 60 * 60 * 1000,
      `Лимит: не больше ${LIMITS.friendReqPerDay} заявок в друзья в сутки`
    );

    const targetId = Number(req.body.userId);
    if (!targetId || targetId === user.id) return res.status(400).json({ ok: false, error: "Некорректный игрок" });
    const target = loadUser(targetId);
    if (!target) return res.status(404).json({ ok: false, error: "Игрок не найден" });
    if ((user.friends || []).includes(targetId)) return res.status(400).json({ ok: false, error: "Уже друзья" });

    if (!(user.friendRequestsOut || []).includes(targetId)) {
      user.friendRequestsOut = [...(user.friendRequestsOut || []), targetId];
    }
    if (!(target.friendRequestsIn || []).includes(user.id)) {
      target.friendRequestsIn = [...(target.friendRequestsIn || []), user.id];
    }

    // auto-accept if mutual
    if ((user.friendRequestsIn || []).includes(targetId)) {
      user.friends = [...new Set([...(user.friends || []), targetId])];
      target.friends = [...new Set([...(target.friends || []), user.id])];
      user.friendRequestsIn = (user.friendRequestsIn || []).filter((id) => id !== targetId);
      user.friendRequestsOut = (user.friendRequestsOut || []).filter((id) => id !== targetId);
      target.friendRequestsIn = (target.friendRequestsIn || []).filter((id) => id !== user.id);
      target.friendRequestsOut = (target.friendRequestsOut || []).filter((id) => id !== user.id);
    }

    await saveUser(user);
    await saveUser(target);
    await checkAutoAwards(user);
    await checkAutoAwards(target);
    res.json({ ok: true, user: profilePayload(loadUser(user.id), loadUser(user.id)) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/friends/accept", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    const fromId = Number(req.body.userId);
    if (!(user.friendRequestsIn || []).includes(fromId)) {
      return res.status(400).json({ ok: false, error: "Заявки нет" });
    }
    const other = loadUser(fromId);
    if (!other) return res.status(404).json({ ok: false, error: "Игрок не найден" });

    user.friends = [...new Set([...(user.friends || []), fromId])];
    other.friends = [...new Set([...(other.friends || []), user.id])];
    user.friendRequestsIn = (user.friendRequestsIn || []).filter((id) => id !== fromId);
    other.friendRequestsOut = (other.friendRequestsOut || []).filter((id) => id !== user.id);

    await saveUser(user);
    await saveUser(other);
    await checkAutoAwards(user);
    await checkAutoAwards(other);
    res.json({ ok: true, user: profilePayload(loadUser(user.id), loadUser(user.id)) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/friends/remove", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    const otherId = Number(req.body.userId);
    const other = loadUser(otherId);
    user.friends = (user.friends || []).filter((id) => id !== otherId);
    user.friendRequestsIn = (user.friendRequestsIn || []).filter((id) => id !== otherId);
    user.friendRequestsOut = (user.friendRequestsOut || []).filter((id) => id !== otherId);
    if (other) {
      other.friends = (other.friends || []).filter((id) => id !== user.id);
      other.friendRequestsIn = (other.friendRequestsIn || []).filter((id) => id !== user.id);
      other.friendRequestsOut = (other.friendRequestsOut || []).filter((id) => id !== user.id);
      await saveUser(other);
    }
    await saveUser(user);
    res.json({ ok: true, user: profilePayload(user, user) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.get("/api/friends", authMiddleware, (req, res) => {
  const user = loadUser(req.user.id);
  const friends = (user.friends || []).map((id) => publicUser(loadUser(id))).filter(Boolean);
  const incoming = (user.friendRequestsIn || []).map((id) => publicUser(loadUser(id))).filter(Boolean);
  res.json({ ok: true, friends, incoming });
});

// ——— Profiles / rating ———
app.get("/api/users/:id", optionalAuth, (req, res) => {
  const user = loadUser(Number(req.params.id));
  if (!user) return res.status(404).json({ ok: false, error: "Не найден" });
  res.json({ ok: true, user: profilePayload(user, req.user || null) });
});

app.get("/api/rating", (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 1000));
  const list = getRatingBoard()
    .slice(0, limit)
    .map((u, i) => ({ ...u, place: i + 1 }));
  res.json({ ok: true, rating: list, total: getRatingBoard().length });
});

app.get("/api/awards", (_req, res) => {
  res.json({ ok: true, awards: awardsPublicList() });
});

// ——— Gifts ———
app.get("/api/gifts", optionalAuth, (req, res) => {
  const catalog = giftsCatalog();
  const left = req.user ? freeGiftsLeft(req.user) : null;
  res.json({ ok: true, gifts: catalog, freeGiftsLeft: left, paymentsEnabled: false });
});

app.post("/api/gifts/send", authMiddleware, async (req, res) => {
  try {
    const giftId = String(req.body.giftId || "");
    const toId = Number(req.body.toUserId || req.body.userId);
    const gift = getGift(giftId);
    if (!gift) return res.status(404).json({ ok: false, error: "Подарок не найден" });
    if (!gift.available) {
      return res.status(402).json({
        ok: false,
        error: "Оплата подарков за рубли скоро. Пока доступен 1 бесплатный подарок.",
        code: "PAYMENTS_SOON",
      });
    }

    const from = loadUser(req.user.id);
    if (!toId || toId === from.id) {
      return res.status(400).json({ ok: false, error: "Кому дарить?" });
    }
    const to = loadUser(toId);
    if (!to) return res.status(404).json({ ok: false, error: "Игрок не найден" });

    limitUserAction(from, "gift", 3000);

    if (gift.free) {
      const left = freeGiftsLeft(from);
      if (left < 1) {
        return res.status(400).json({
          ok: false,
          error: "Бесплатный подарок уже использован. Платные — скоро за рубли.",
        });
      }
      from.freeGiftsLeft = left - 1;
    } else {
      return res.status(402).json({ ok: false, error: "Оплата ещё не подключена", code: "PAYMENTS_SOON" });
    }

    const entry = {
      id: `${Date.now()}-${from.id}`,
      giftId: gift.id,
      title: gift.title,
      icon: gift.icon,
      fromId: from.id,
      fromNick: from.nick,
      toId: to.id,
      toNick: to.nick,
      at: new Date().toISOString(),
      paid: false,
    };

    from.giftsSent = [...(from.giftsSent || []), entry];
    to.giftsReceived = [...(to.giftsReceived || []), entry];
    await saveUser(from);
    await saveUser(to);

    // подарок видно всем в живой ленте
    const sysText = `${from.nick} подарил «${gift.title}» → ${to.nick}`;
    const sysMsg = {
      id: `gift-${entry.id}`,
      system: true,
      text: sysText,
      at: entry.at,
      userId: from.id,
      nick: from.nick,
      avatar: from.avatar || DEFAULT_AVATAR,
    };
    writeChat(globalChatPath(), sysMsg);
    broadcastRoom("global", { type: "gift", text: sysText, at: entry.at, gift: entry });
    broadcastChat(sysMsg);

    res.json({
      ok: true,
      gift: entry,
      freeGiftsLeft: freeGiftsLeft(from),
      user: profilePayload(from, from),
    });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ——— Chat (global + per-game) + ЛС ———
const chatClients = new Set(); // { ws, rooms: Set<string>, userId?: number }

function broadcastRoom(room, payload) {
  const raw = JSON.stringify(payload);
  for (const client of chatClients) {
    if (client.ws.readyState === 1 && client.rooms.has(room)) {
      client.ws.send(raw);
    }
  }
}

function broadcastChat(msg) {
  broadcastRoom("global", { type: "chat", room: "global", message: msg });
}

function broadcastGameChat(code, msg) {
  broadcastRoom(`game:${code}`, { type: "chat", room: `game:${code}`, message: msg });
}

function broadcastDm(a, b, msg) {
  broadcastRoom(`dm:${a}`, { type: "dm", message: msg });
  broadcastRoom(`dm:${b}`, { type: "dm", message: msg });
}

async function bumpDmIndex(userId, peerId, preview, at) {
  const file = dmIndexPath(userId);
  let list = readJson(file, []);
  list = list.filter((x) => x.peerId !== peerId);
  list.unshift({ peerId, preview: String(preview).slice(0, 80), at });
  await writeJson(file, list.slice(0, 100));
}

async function postPublicChat({ user, text, file, room, broadcast }) {
  limitUserAction(user, "chat", LIMITS.chatMinInterval);
  limitUserCount(user, "chat", LIMITS.chatPerHour, 60 * 60 * 1000);
  let body = String(text || "").trim();
  if (!body) {
    const err = new Error("Пустое сообщение");
    err.status = 400;
    throw err;
  }
  if (body.length > LIMITS.chatMaxLen) body = body.slice(0, LIMITS.chatMaxLen);
  if (user.lastActions.lastChatText === body) {
    const err = new Error("Нельзя слать одно и то же подряд");
    err.status = 429;
    throw err;
  }
  user.lastActions.lastChatText = body;

  const msg = {
    id: `${Date.now()}-${user.id}`,
    userId: user.id,
    nick: user.nick,
    avatar: user.avatar || DEFAULT_AVATAR,
    text: body,
    at: new Date().toISOString(),
    room,
  };
  writeChat(file, msg);
  user.stats.messages += 1;
  const before = user.rating;
  user.rating = calcRating(user);
  await recordActivity(user.id, { ratingDelta: user.rating - before });
  await checkAutoAwards(user);
  await saveUser(user);
  await updateRatingIndex(user);
  broadcast(msg);
  return msg;
}

app.get("/api/chat/history", (_req, res) => {
  res.json({ ok: true, messages: readChatTail(globalChatPath(), 150) });
});

app.post("/api/chat", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    const msg = await postPublicChat({
      user,
      text: req.body.text,
      file: globalChatPath(),
      room: "global",
      broadcast: broadcastChat,
    });
    res.json({ ok: true, message: msg });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.get("/api/chat/game/:code/history", (req, res) => {
  const game = findGame(req.params.code);
  if (!game) return res.status(404).json({ ok: false, error: "Игра не найдена" });
  res.json({
    ok: true,
    game: { code: game.code, name: game.name },
    messages: readChatTail(gameChatPath(game.code), 150),
  });
});

app.post("/api/chat/game/:code", authMiddleware, async (req, res) => {
  try {
    const game = findGame(req.params.code);
    if (!game) return res.status(404).json({ ok: false, error: "Игра не найдена" });
    const user = loadUser(req.user.id);
    const msg = await postPublicChat({
      user,
      text: req.body.text,
      file: gameChatPath(game.code),
      room: `game:${game.code}`,
      broadcast: (m) => broadcastGameChat(game.code, m),
    });
    res.json({ ok: true, message: msg });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.get("/api/dm", authMiddleware, (req, res) => {
  const list = readJson(dmIndexPath(req.user.id), []);
  const enriched = list.map((row) => {
    const peer = publicUser(loadUser(row.peerId));
    return { ...row, peer };
  }).filter((x) => x.peer);
  res.json({ ok: true, conversations: enriched });
});

app.get("/api/dm/:peerId", authMiddleware, (req, res) => {
  const peerId = Number(req.params.peerId);
  const user = loadUser(req.user.id);
  if (!peerId || peerId === user.id) {
    return res.status(400).json({ ok: false, error: "Некорректный собеседник" });
  }
  const peer = loadUser(peerId);
  if (!peer) return res.status(404).json({ ok: false, error: "Игрок не найден" });
  const isFriend = (user.friends || []).includes(peerId);
  res.json({
    ok: true,
    peer: publicUser(peer),
    isFriend,
    messages: readChatTail(dmPath(user.id, peerId), 200),
  });
});

app.post("/api/dm/:peerId", authMiddleware, async (req, res) => {
  try {
    const peerId = Number(req.params.peerId);
    const user = loadUser(req.user.id);
    if (!peerId || peerId === user.id) {
      return res.status(400).json({ ok: false, error: "Некорректный собеседник" });
    }
    const peer = loadUser(peerId);
    if (!peer) return res.status(404).json({ ok: false, error: "Игрок не найден" });
    if (!(user.friends || []).includes(peerId)) {
      return res.status(403).json({ ok: false, error: "ЛС только между друзьями" });
    }

    limitUserAction(user, "dm", LIMITS.chatMinInterval);
    limitUserCount(user, "dm", LIMITS.chatPerHour, 60 * 60 * 1000);

    let text = String(req.body.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "Пустое сообщение" });
    if (text.length > LIMITS.chatMaxLen) text = text.slice(0, LIMITS.chatMaxLen);

    const msg = {
      id: `${Date.now()}-${user.id}`,
      fromId: user.id,
      toId: peerId,
      nick: user.nick,
      avatar: user.avatar || DEFAULT_AVATAR,
      text,
      at: new Date().toISOString(),
    };
    writeChat(dmPath(user.id, peerId), msg);
    await bumpDmIndex(user.id, peerId, text, msg.at);
    await bumpDmIndex(peerId, user.id, text, msg.at);

    user.stats.messages += 1;
    user.rating = calcRating(user);
    await saveUser(user);
    await updateRatingIndex(user);

    broadcastDm(user.id, peerId, msg);
    res.json({ ok: true, message: msg });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ——— Forum ———
app.get("/api/forum/threads", (_req, res) => {
  const threads = readJson(forumIndexPath(), []);
  res.json({ ok: true, threads: threads.slice(0, 100) });
});

function reqParams(req) {
  return String(req.params.id).replace(/[^\d]/g, "");
}

app.get("/api/forum/threads/:id", (req, res) => {
  const file = path.join(DATA_DIR, "forum", `thread-${reqParams(req)}.json`);
  const thread = readJson(file, null);
  if (!thread) return res.status(404).json({ ok: false, error: "Тема не найдена" });
  res.json({ ok: true, thread });
});

app.post("/api/forum/threads", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "forumThread", LIMITS.forumThreadMinInterval);

    const title = String(req.body.title || "").trim().slice(0, 120);
    const body = String(req.body.body || "").trim().slice(0, 4000);
    if (title.length < 3 || body.length < 3) {
      return res.status(400).json({ ok: false, error: "Заголовок и текст обязательны" });
    }

    const id = await nextCounter("nextThreadId");
    const postId = await nextCounter("nextPostId");
    const thread = {
      id,
      title,
      authorId: user.id,
      authorNick: user.nick,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      posts: [
        {
          id: postId,
          authorId: user.id,
          authorNick: user.nick,
          avatar: user.avatar || DEFAULT_AVATAR,
          body,
          at: new Date().toISOString(),
        },
      ],
    };
    await writeJson(path.join(DATA_DIR, "forum", `thread-${id}.json`), thread);
    const index = readJson(forumIndexPath(), []);
    index.unshift({
      id,
      title,
      authorId: user.id,
      authorNick: user.nick,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      postsCount: 1,
    });
    await writeJson(forumIndexPath(), index.slice(0, 500));

    if (!(user.awards || []).some((a) => a.id === "forum_starter")) {
      user.awards = [...(user.awards || []), { id: "forum_starter", at: new Date().toISOString() }];
    }
    user.stats.messages += 1;
    user.rating = calcRating(user);
    await saveUser(user);
    await updateRatingIndex(user);

    res.json({ ok: true, thread });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

app.post("/api/forum/threads/:id/posts", authMiddleware, async (req, res) => {
  try {
    const user = loadUser(req.user.id);
    limitUserAction(user, "forumPost", LIMITS.forumPostMinInterval);

    const id = reqParams(req);
    const file = path.join(DATA_DIR, "forum", `thread-${id}.json`);
    const thread = readJson(file, null);
    if (!thread) return res.status(404).json({ ok: false, error: "Тема не найдена" });

    const body = String(req.body.body || "").trim().slice(0, 4000);
    if (body.length < 1) return res.status(400).json({ ok: false, error: "Пустой ответ" });

    const postId = await nextCounter("nextPostId");
    const post = {
      id: postId,
      authorId: user.id,
      authorNick: user.nick,
      avatar: user.avatar || DEFAULT_AVATAR,
      body,
      at: new Date().toISOString(),
    };
    thread.posts.push(post);
    thread.updatedAt = post.at;
    await writeJson(file, thread);

    const index = readJson(forumIndexPath(), []);
    const row = index.find((t) => t.id === Number(id));
    if (row) {
      row.updatedAt = thread.updatedAt;
      row.postsCount = thread.posts.length;
      index.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      await writeJson(forumIndexPath(), index);
    }

    user.stats.messages += 1;
    user.rating = calcRating(user);
    await saveUser(user);
    await updateRatingIndex(user);

    res.json({ ok: true, post, thread });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ——— Pretty URLs / site pages → публичный клиент на wgl.su ———
const PUBLIC_SITE = (process.env.WGL_PUBLIC_SITE || "https://wgl.su").replace(/\/$/, "");

function redirectToSite(req, res) {
  res.redirect(302, PUBLIC_SITE + req.originalUrl);
}

app.get("/api/g/:code", (req, res) => {
  const game = findGame(req.params.code);
  if (!game) return res.status(404).json({ ok: false, error: "Игра не найдена" });
  res.json({ ok: true, game: { ...game, play: playPath(game) } });
});

app.get(["/", "/index.html"], (_req, res) => {
  res.redirect(302, PUBLIC_SITE + "/");
});

app.get(
  ["/g/:code", "/id:id", "/user/:id", "/user/id:id", "/rating", "/rating/"],
  redirectToSite
);

// API runtime only: uploads + assets (no site index / client pages)
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "1d" }));
app.use("/assets", express.static(path.join(ROOT, "assets"), { maxAge: "1h" }));

app.use((req, res, next) => {
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/uploads") ||
    req.path.startsWith("/assets") ||
    req.path === "/ws"
  ) {
    return next();
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return res.redirect(302, PUBLIC_SITE + (req.originalUrl || "/"));
  }
  next();
});

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ ok: false, error: "Не найдено" });
  }
  res.status(404).end();
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ ok: false, error: err.message || "Ошибка сервера" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  const client = { ws, rooms: new Set(["global"]) };
  chatClients.add(client);
  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(String(raw));
      if (data.type === "join" && typeof data.room === "string") {
        const room = data.room.slice(0, 40);
        if (/^(global|game:[a-z0-9]{3,8}|dm:\d+)$/.test(room)) {
          client.rooms.add(room);
        }
      }
      if (data.type === "leave" && typeof data.room === "string") {
        client.rooms.delete(data.room);
      }
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => chatClients.delete(client));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WGL API on :${PORT} (site → ${PUBLIC_SITE})`);
  rebuildRatingBoard(calcRating)
    .then((n) => console.log(`rating rebuilt for ${n} users`))
    .catch((e) => console.error("rating rebuild failed", e));
  runPeriodAwards().catch(() => {});
  setInterval(() => runPeriodAwards().catch(() => {}), 60 * 60 * 1000);
});
