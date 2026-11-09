/**
 * Scoring, in integer points so leaderboards never compare floating-point noise.
 *   base  = 100 per mark
 *   bonus = up to +50% of base, falling linearly from the moment the question is shown to the time limit
 *   wrong, blank or late answers score 0
 * Total time is only used to break ties: equal points -> less total answering time ranks higher.
 */
export const POINTS_PER_MARK = 100;
export const MAX_SPEED_BONUS = 0.5;
/** Network slack: an answer up to this long after the limit is still treated as on time (but earns no bonus). */
export const GRACE_MS = 2000;

export function computePoints(opts: { correct: boolean; marks: number; elapsedMs: number; limitMs: number }) {
  const late = opts.elapsedMs > opts.limitMs + GRACE_MS;
  if (!opts.correct || late) return { points: 0, late };
  const base = Math.round(opts.marks * POINTS_PER_MARK);
  const frac = Math.min(1, Math.max(0, 1 - opts.elapsedMs / opts.limitMs));
  return { points: base + Math.round(base * MAX_SPEED_BONUS * frac), late };
}
