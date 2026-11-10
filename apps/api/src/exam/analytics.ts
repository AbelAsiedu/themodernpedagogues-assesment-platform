/** Pure statistics helpers, kept apart from the database so they can be tested directly. */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ScoreSummary { n: number; mean: number; median: number; min: number; max: number; distribution: { from: number; to: number; count: number }[] }

/** Percent scores (0–100) of fully marked attempts. Ten bands: 0–9, 10–19 … 90–100 (the last includes 100). */
export function summariseScores(percents: number[]): ScoreSummary | null {
  if (!percents.length) return null;
  const s = [...percents].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  const distribution = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
  for (const p of s) distribution[Math.min(9, Math.floor(p / 10))]!.count++;
  return { n: s.length, mean: r2(s.reduce((a, b) => a + b, 0) / s.length), median: r2(median), min: r2(s[0]!), max: r2(s[s.length - 1]!), distribution };
}

/** Facility = average mark as a share of the maximum (1 means everyone got it all, 0 means nobody scored). */
export const facility = (awardedTotal: number, count: number, max: number): number | null => (count > 0 && max > 0 ? r2(awardedTotal / count / max) : null);
