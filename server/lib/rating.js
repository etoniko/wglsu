/** Рейтинг = игры×15 + сообщения×3 + минуты игры×2 */
export function calcRating(user) {
  const s = user.stats || {};
  const games = Number(s.gamesPlayed) || 0;
  const messages = Number(s.messages) || 0;
  const minutes = Math.floor((Number(s.totalPlayMs) || 0) / 60000);
  return games * 15 + messages * 3 + minutes * 2;
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
