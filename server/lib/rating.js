/**
 * Рейтинг игрока.
 * 100+ — зона сильных задротов (десятки часов + много сессий/чата).
 *
 * games×1 + floor(messages/3) + floor(minutes/20)
 *
 * Ориентиры:
 * - 10 игр, 30 сообщений, 2 часа ≈ 26
 * - 20 игр, 50 сообщений, 5 часов ≈ 51
 * - 40 игр, 100 сообщений, 10 часов ≈ 103
 * - только время: 100 очков ≈ 33 часа игры
 */
export function calcRating(user) {
  const s = user.stats || {};
  const games = Number(s.gamesPlayed) || 0;
  const messages = Number(s.messages) || 0;
  const minutes = Math.floor((Number(s.totalPlayMs) || 0) / 60000);
  return games + Math.floor(messages / 3) + Math.floor(minutes / 20);
}

export function formatPlayTime(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}
