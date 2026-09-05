import path from "path";
import { fileURLToPath } from "url";
import {
  DATA_DIR,
  readJson,
  writeJson,
  loadUser,
  saveUser,
  updateRatingIndex,
  ratingIndexPath,
} from "./store.js";
import { calcRating } from "./rating.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AWARD_DEFS = [
  { id: "first_game", title: "Первая игра", desc: "Отыграл первую сессию", icon: "first_game.png", auto: true },
  { id: "games_10", title: "Ветеран 10", desc: "10 игровых сессий", icon: "games_10.png", auto: true },
  { id: "games_50", title: "Ветеран 50", desc: "50 игровых сессий", icon: "games_50.png", auto: true },
  { id: "games_100", title: "Сотня", desc: "100 игровых сессий", icon: "games_100.png", auto: true },
  { id: "time_1h", title: "Час в зоне", desc: "1 час суммарно", icon: "time_1h.png", auto: true },
  { id: "time_10h", title: "Десять часов", desc: "10 часов суммарно", icon: "time_10h.png", auto: true },
  { id: "time_50h", title: "Марафонец", desc: "50 часов суммарно", icon: "time_50h.png", auto: true },
  { id: "chatty_50", title: "Болтун", desc: "50 сообщений в чате", icon: "chatty_50.png", auto: true },
  { id: "chatty_200", title: "Оратор", desc: "200 сообщений", icon: "chatty_200.png", auto: true },
  { id: "social_5", title: "Компанейский", desc: "5 друзей", icon: "social_5.png", auto: true },
  { id: "voter", title: "Судья", desc: "Проголосовал за игру", icon: "voter.png", auto: true },
  { id: "rating_100", title: "Рейтинг 100", desc: "Набрал 100 рейтинга", icon: "rating_100.png", auto: true },
  { id: "rating_500", title: "Рейтинг 500", desc: "Набрал 500 рейтинга", icon: "rating_500.png", auto: true },
  { id: "rating_1000", title: "Легенда 1000", desc: "Набрал 1000 рейтинга", icon: "rating_1000.png", auto: true },
  { id: "most_games_today", title: "Больше всех игр сегодня", desc: "Лидер по сессиям за день", icon: "most_games_today.png", period: "daily" },
  { id: "most_time_today", title: "Дольше всех сегодня", desc: "Лидер по времени за день", icon: "most_time_today.png", period: "daily" },
  { id: "most_games_week", title: "Больше всех игр за неделю", desc: "Лидер недели по сессиям", icon: "most_games_week.png", period: "weekly" },
  { id: "most_time_week", title: "Дольше всех за неделю", desc: "Лидер недели по времени", icon: "most_time_week.png", period: "weekly" },
  { id: "most_games_year", title: "Больше всех игр за год", desc: "Лидер года по сессиям", icon: "most_games_year.png", period: "yearly" },
  { id: "most_time_year", title: "Дольше всех за год", desc: "Лидер года по времени", icon: "most_time_year.png", period: "yearly" },
  { id: "top_rating_day", title: "Топ рейтинга дня", desc: "Лучший прирост рейтинга за день", icon: "top_rating_day.png", period: "daily" },
  { id: "night_owl", title: "Ночная сова", desc: "Играл между 0:00 и 5:00", icon: "night_owl.png", auto: true },
  { id: "early_bird", title: "Ранняя пташка", desc: "Играл между 5:00 и 8:00", icon: "early_bird.png", auto: true },
  { id: "forum_starter", title: "Автор темы", desc: "Создал тему на форуме", icon: "forum_starter.png", auto: true },
];

export function awardsPublicList() {
  return AWARD_DEFS.map((a) => ({
    id: a.id,
    title: a.title,
    desc: a.desc,
    icon: `/assets/awards/${a.icon}`,
  }));
}

function hasAward(user, id) {
  return (user.awards || []).some((a) => a.id === id);
}

function grant(user, id) {
  if (hasAward(user, id)) return false;
  const def = AWARD_DEFS.find((a) => a.id === id);
  if (!def) return false;
  if (!user.awards) user.awards = [];
  user.awards.push({ id, at: new Date().toISOString() });
  return true;
}

export async function checkAutoAwards(user) {
  let changed = false;
  const s = user.stats || {};
  const games = s.gamesPlayed || 0;
  const msgs = s.messages || 0;
  const ms = s.totalPlayMs || 0;
  const friends = (user.friends || []).length;
  const rating = calcRating(user);

  const checks = [
    [games >= 1, "first_game"],
    [games >= 10, "games_10"],
    [games >= 50, "games_50"],
    [games >= 100, "games_100"],
    [ms >= 3600000, "time_1h"],
    [ms >= 36000000, "time_10h"],
    [ms >= 180000000, "time_50h"],
    [msgs >= 50, "chatty_50"],
    [msgs >= 200, "chatty_200"],
    [friends >= 5, "social_5"],
    [Object.values(user.votes || {}).some((n) => Number(n) > 0), "voter"],
    [rating >= 100, "rating_100"],
    [rating >= 500, "rating_500"],
    [rating >= 1000, "rating_1000"],
  ];

  for (const [cond, id] of checks) {
    if (cond && grant(user, id)) changed = true;
  }

  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5 && grant(user, "night_owl")) changed = true;
  if (hour >= 5 && hour < 8 && grant(user, "early_bird")) changed = true;

  if (changed) {
    user.rating = calcRating(user);
    await saveUser(user);
    await updateRatingIndex(user);
  }
  return changed;
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function yearKey(d = new Date()) {
  return String(d.getUTCFullYear());
}

const activityPath = () => path.join(DATA_DIR, "meta", "activity.json");

export async function recordActivity(userId, { playMs = 0, games = 0, ratingDelta = 0 } = {}) {
  const file = activityPath();
  const data = readJson(file, { daily: {}, weekly: {}, yearly: {} });
  const dk = dayKey();
  const wk = weekKey();
  const yk = yearKey();

  for (const [bucket, key] of [
    ["daily", dk],
    ["weekly", wk],
    ["yearly", yk],
  ]) {
    if (!data[bucket][key]) data[bucket][key] = {};
    if (!data[bucket][key][userId]) {
      data[bucket][key][userId] = { playMs: 0, games: 0, ratingDelta: 0 };
    }
    const row = data[bucket][key][userId];
    row.playMs += playMs;
    row.games += games;
    row.ratingDelta += ratingDelta;
  }

  // prune old daily (keep 14 days)
  const days = Object.keys(data.daily).sort();
  while (days.length > 14) {
    delete data.daily[days.shift()];
  }

  await writeJson(file, data);
}

export async function runPeriodAwards() {
  const stateFile = path.join(DATA_DIR, "meta", "awards-state.json");
  const state = readJson(stateFile, { lastDaily: "", lastWeekly: "", lastYearly: "" });
  const activity = readJson(activityPath(), { daily: {}, weekly: {}, yearly: {} });
  let changed = false;

  async function awardLeaders(periodKey, map, gamesAward, timeAward, ratingAward) {
    const rows = Object.entries(map || {}).map(([id, v]) => ({
      id: Number(id),
      ...v,
    }));
    if (!rows.length) return;

    const byGames = [...rows].sort((a, b) => b.games - a.games || b.playMs - a.playMs)[0];
    const byTime = [...rows].sort((a, b) => b.playMs - a.playMs || b.games - a.games)[0];
    const byRating = [...rows].sort((a, b) => b.ratingDelta - a.ratingDelta || b.playMs - a.playMs)[0];

    for (const [row, awardId] of [
      [byGames, gamesAward],
      [byTime, timeAward],
      [byRating, ratingAward],
    ]) {
      if (!row || !awardId) continue;
      const user = loadUser(row.id);
      if (!user) continue;
      if (grant(user, awardId)) {
        await saveUser(user);
        await updateRatingIndex(user);
      }
    }
  }

  const today = dayKey();
  // Award for *previous* completed day once per new day
  if (state.lastDaily !== today) {
    const days = Object.keys(activity.daily || {}).sort();
    const prev = days.filter((d) => d < today).pop();
    if (prev) {
      await awardLeaders(prev, activity.daily[prev], "most_games_today", "most_time_today", "top_rating_day");
    }
    state.lastDaily = today;
    changed = true;
  }

  const thisWeek = weekKey();
  if (state.lastWeekly !== thisWeek) {
    const weeks = Object.keys(activity.weekly || {}).sort();
    const prev = weeks.filter((w) => w < thisWeek).pop();
    if (prev) {
      await awardLeaders(prev, activity.weekly[prev], "most_games_week", "most_time_week", null);
    }
    state.lastWeekly = thisWeek;
    changed = true;
  }

  const thisYear = yearKey();
  if (state.lastYearly !== thisYear) {
    const years = Object.keys(activity.yearly || {}).sort();
    const prev = years.filter((y) => y < thisYear).pop();
    if (prev) {
      await awardLeaders(prev, activity.yearly[prev], "most_games_year", "most_time_year", null);
    }
    state.lastYearly = thisYear;
    changed = true;
  }

  if (changed) await writeJson(stateFile, state);
}

export function iconDir() {
  return path.join(__dirname, "..", "..", "assets", "awards");
}
