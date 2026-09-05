/**
 * Голоса игрока = число отыгранных игр (gamesPlayed).
 * Можно размазать по карточкам или вложить все в одну, можно забрать назад.
 */

export function voteBudget(user) {
  return Math.max(0, Number(user.stats?.gamesPlayed) || 0);
}

export function normalizeUserVotes(votes) {
  const out = {};
  if (!votes || typeof votes !== "object") return out;
  for (const [id, raw] of Object.entries(votes)) {
    let n = Number(raw);
    // legacy ±1 → только плюс-голоса
    if (n < 0) n = 0;
    n = Math.floor(n);
    if (n > 0) out[id] = n;
  }
  return out;
}

export function votesUsed(votes) {
  return Object.values(normalizeUserVotes(votes)).reduce((a, b) => a + b, 0);
}

export function votesLeft(user) {
  return Math.max(0, voteBudget(user) - votesUsed(user.votes));
}

export function voteSummary(user) {
  const votes = normalizeUserVotes(user.votes);
  const budget = voteBudget(user);
  const used = votesUsed(votes);
  return {
    budget,
    used,
    left: Math.max(0, budget - used),
    votes,
  };
}
