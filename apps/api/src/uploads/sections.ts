import { LIMITS } from "./errors.js";

export interface RawSection { label: string; text: string; ocr?: boolean }

/** Pack paragraphs into sections of roughly `target` characters on paragraph boundaries (a long paragraph is split on spaces). */
export function chunkParagraphs(paras: string[], labelPrefix: string, target: number = LIMITS.sectionChars): RawSection[] {
  const out: RawSection[] = [];
  let cur: string[] = []; let len = 0;
  const flush = () => { if (cur.length) { out.push({ label: "", text: cur.join("\n") }); cur = []; len = 0; } };
  for (const raw of paras) {
    const p = raw.replace(/[ \t]+/g, " ").trim();
    if (!p) continue;
    for (const piece of splitLong(p, target)) {
      if (len + piece.length > target && len > 0) flush();
      cur.push(piece); len += piece.length + 1;
    }
  }
  flush();
  return out.map((s, i, all) => ({ ...s, label: all.length === 1 ? labelPrefix : `${labelPrefix} (part ${i + 1} of ${all.length})` }));
}

function splitLong(p: string, target: number): string[] {
  if (p.length <= target) return [p];
  const parts: string[] = [];
  let rest = p;
  while (rest.length > target) {
    let cut = rest.lastIndexOf(" ", target);
    if (cut < target / 2) cut = target;
    parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Keep the total under the cap and the section list bounded; say so when something was cut. */
export function capSections(sections: RawSection[], warnings: string[]): RawSection[] {
  let total = 0; const kept: RawSection[] = [];
  for (const s of sections) {
    if (kept.length >= LIMITS.maxSections || total >= LIMITS.totalChars) { warnings.push("This file is very long, so only the first part was kept."); break; }
    const room = LIMITS.totalChars - total;
    const text = s.text.length > room ? s.text.slice(0, room) : s.text;
    kept.push({ ...s, text }); total += text.length;
  }
  return kept;
}
