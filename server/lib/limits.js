/**
 * Анти-макро / анти-скрипт лимиты.
 * Хранятся в памяти + зеркалятся в user.lastActions.
 */

const ipBuckets = new Map();

function pruneBucket(map, key, windowMs) {
  const now = Date.now();
  let arr = map.get(key) || [];
  arr = arr.filter((t) => now - t < windowMs);
  map.set(key, arr);
  return arr;
}

export function limitIp(ip, action, max, windowMs) {
  const key = `${action}:${ip || "unknown"}`;
  const arr = pruneBucket(ipBuckets, key, windowMs);
  if (arr.length >= max) {
    const err = new Error("Слишком много попыток. Подождите немного.");
    err.status = 429;
    err.code = "RATE_LIMIT";
    throw err;
  }
  arr.push(Date.now());
  ipBuckets.set(key, arr);
}

export function limitUserAction(user, action, minIntervalMs) {
  if (!user.lastActions) user.lastActions = {};
  const last = user.lastActions[action] || 0;
  const now = Date.now();
  if (now - last < minIntervalMs) {
    const wait = Math.ceil((minIntervalMs - (now - last)) / 1000);
    const err = new Error(`Слишком быстро. Подождите ${wait} сек.`);
    err.status = 429;
    err.code = "RATE_LIMIT";
    throw err;
  }
  user.lastActions[action] = now;
}

export function limitUserCount(user, action, max, windowMs, message) {
  if (!user.lastActions) user.lastActions = {};
  const key = `${action}_times`;
  const now = Date.now();
  let arr = (user.lastActions[key] || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const err = new Error(message || "Лимит действий исчерпан. Попробуйте позже.");
    err.status = 429;
    err.code = "RATE_LIMIT";
    throw err;
  }
  arr.push(now);
  user.lastActions[key] = arr;
}

/** Простая проверка «человечности»: клиент шлёт challenge-ответ */
export function verifyHuman(payload) {
  const { challenge, answer, t0 } = payload || {};
  if (!challenge || answer === undefined || !t0) {
    const err = new Error("Проверка антибота не пройдена");
    err.status = 400;
    throw err;
  }
  const elapsed = Date.now() - Number(t0);
  // слишком быстро = бот; слишком долго = устаревший challenge
  if (elapsed < 800 || elapsed > 10 * 60 * 1000) {
    const err = new Error("Подозрительная скорость регистрации");
    err.status = 400;
    throw err;
  }
  const expected = simpleChallengeAnswer(challenge);
  if (String(answer) !== String(expected)) {
    const err = new Error("Неверный ответ антибот-проверки");
    err.status = 400;
    throw err;
  }
}

export function makeChallenge() {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * 9);
  const challenge = `${a}+${b}`;
  return { challenge, t0: Date.now() };
}

export function simpleChallengeAnswer(challenge) {
  const m = String(challenge).match(/^(\d+)\+(\d+)$/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]);
}

export const LIMITS = {
  registerPerIp: { max: 3, windowMs: 60 * 60 * 1000 },
  loginPerIp: { max: 20, windowMs: 15 * 60 * 1000 },
  captchaPerIp: { max: 40, windowMs: 15 * 60 * 1000 },
  chatMinInterval: 3000,
  chatMaxLen: 400,
  chatPerHour: 120,
  voteMinInterval: 1500,
  friendReqPerDay: 10,
  friendReqMinInterval: 5000,
  playHeartbeatMin: 25 * 1000,
  playHeartbeatMaxCredit: 90 * 1000,
  forumPostMinInterval: 15 * 1000,
  forumThreadMinInterval: 60 * 1000,
  searchMinInterval: 500,
  avatarMinInterval: 60 * 1000,
};
