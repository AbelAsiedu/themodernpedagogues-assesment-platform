import type { StoredParsedQuestion, StoredQuestionTable } from "../db/schema.js";
import { LIMITS } from "./errors.js";
import type { Grid } from "./xlsx.js";

/**
 * Recognise a table of ready-made questions (Wayground/Quizizz export layout, or any sheet with similar headings) and read it
 * WITHOUT any AI. The result is a preview: nothing is saved as a question until the teacher imports it.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const EXPLANATION = new Set(["answer explanation", "explanation", "rationale", "feedback", "solution", "reason"]);
const STEM = new Set(["question", "question text", "questions", "stem", "prompt", "question stem"]);
const TYPE = new Set(["question type", "type"]);
const CORRECT = new Set(["correct answer", "correct answers", "correct", "answer", "key", "correct option", "right answer", "answer key"]);
const MARKS = new Set(["marks", "mark", "points", "score"]);
const DIFFICULTY = new Set(["difficulty"]);
const TIME = new Set(["time in seconds", "time", "time limit", "time limit seconds", "seconds", "time s", "timer"]);
const IMAGE = new Set(["image link", "image", "image url", "picture"]);
const OPTION_RE = /^(?:option|choice|answer)\s*([1-6]|[a-f])$|^([a-f])$/;

interface Cols { stem: number; type: number; correct: number; explanation: number; marks: number; difficulty: number; time: number; image: number; options: { col: number; pos: number }[] }

function readHeader(row: string[]): Cols | null {
  const c: Cols = { stem: -1, type: -1, correct: -1, explanation: -1, marks: -1, difficulty: -1, time: -1, image: -1, options: [] };
  row.forEach((raw, i) => {
    const h = norm(raw ?? "");
    if (!h) return;
    const first = (k: Exclude<keyof Cols, "options">) => { if (c[k] < 0) c[k] = i; };
    if (EXPLANATION.has(h)) first("explanation");
    else if (STEM.has(h)) first("stem");
    else if (TYPE.has(h)) first("type");
    else if (CORRECT.has(h)) first("correct");
    else if (MARKS.has(h)) first("marks");
    else if (DIFFICULTY.has(h)) first("difficulty");
    else if (TIME.has(h)) first("time");
    else if (IMAGE.has(h)) first("image");
    else {
      const m = OPTION_RE.exec(h);
      const tok = m?.[1] ?? m?.[2];
      if (tok) c.options.push({ col: i, pos: /\d/.test(tok) ? Number(tok) : tok.charCodeAt(0) - 96 });
    }
  });
  c.options.sort((a, b) => a.pos - b.pos);
  return c.stem >= 0 && (c.options.length >= 2 || c.correct >= 0) ? c : null;
}

type Kind = "mcq" | "true_false" | "short_answer" | "unsupported" | "unknown" | "infer";
function mapType(raw: string): { kind: Kind; problem?: string } {
  const t = norm(raw);
  if (!t) return { kind: "infer" };
  if (/^(multiple choice|mcq|multiple choice question|single choice|single select|single answer|choose one|multiple choice single answer)$/.test(t)) return { kind: "mcq" };
  if (/^(true false|truefalse|tf|true or false)$/.test(t)) return { kind: "true_false" };
  if (/^(fill in the blank|fill in the blanks|fill blank|fill up|blank|short answer|one word|text)$/.test(t)) return { kind: "short_answer" };
  if (/(checkbox|multi select|multiple select|multiple response|multiple answer|select all)/.test(t)) return { kind: "unsupported", problem: "This question has more than one correct answer, which isn't supported yet." };
  if (/(open ended|essay|paragraph|long answer|subjective|draw|structured)/.test(t)) return { kind: "unsupported", problem: "Open-ended questions need a marking guide, so they can't be imported here. Add them in the question bank with marking points." };
  if (/(poll|survey|rating|word cloud)/.test(t)) return { kind: "unsupported", problem: "Polls and surveys have no right answer, so they can't be imported." };
  return { kind: "unknown", problem: `Unknown question type "${raw.trim()}".` };
}

const LETTERS = "ABCDEF";

function resolveCorrect(raw: string, slots: string[], compactOf: number[]): { index: number | null; problem?: string } {
  const r = raw.trim();
  if (!r) return { index: null, problem: "No correct answer is given." };
  const toCompact = (slot: number): { index: number | null; problem?: string } => {
    const k = compactOf[slot];
    return k === undefined || k < 0 ? { index: null, problem: "The correct answer points at an empty option." } : { index: k };
  };
  if (/^\d+$/.test(r)) {
    const n = Number(r);
    if (n >= 1 && n <= slots.length) return toCompact(n - 1);
    const hit = slots.findIndex((s) => s && norm(s) === norm(r));
    if (hit >= 0) return toCompact(hit);
    return { index: null, problem: `The correct answer "${r}" is not one of the options.` };
  }
  if (/^[A-Fa-f]$/.test(r)) {
    const n = LETTERS.indexOf(r.toUpperCase());
    return n < slots.length ? toCompact(n) : { index: null, problem: `The correct answer "${r}" is not one of the options.` };
  }
  if (/^(\d+|[A-Fa-f])(\s*(,|;|&|and|\s)\s*(\d+|[A-Fa-f]))+$/i.test(r)) return { index: null, problem: "This question has more than one correct answer, which isn't supported yet." };
  const hit = slots.findIndex((s) => s && norm(s) === norm(r));
  if (hit >= 0) return toCompact(hit);
  return { index: null, problem: `The correct answer "${r.length > 40 ? r.slice(0, 40) + "…" : r}" doesn't match any option.` };
}

const parseBool = (s: string): boolean | null => {
  const t = norm(s);
  if (["true", "t", "yes", "correct"].includes(t)) return true;
  if (["false", "f", "no", "incorrect", "wrong"].includes(t)) return false;
  return null;
};

function parseRow(cells: string[], c: Cols, itemNo: number, sourceRow: number, sheet: string): StoredParsedQuestion {
  const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  const stem = cell(c.stem);
  const problems: string[] = [], notes: string[] = [];
  const slots = c.options.map((o) => cell(o.col));
  const compactOf: number[] = []; const options: string[] = [];
  slots.forEach((s, i) => { if (s) { compactOf[i] = options.length; options.push(s); } else compactOf[i] = -1; });
  const t = mapType(cell(c.type));
  const item: StoredParsedQuestion = {
    row: itemNo, sourceRow, sheet, type: "mcq", stem, options: [], correctIndex: null, correctBool: null, accepted: [], explanation: cell(c.explanation) || null,
    marks: null, difficulty: null, timeSec: null, problems, notes,
  };
  if (!stem) problems.push("There is no question text.");
  else if (stem.length > 2000) problems.push("The question is longer than 2000 characters.");
  if (t.problem) problems.push(t.problem);
  if (item.explanation && item.explanation.length > 2000) { item.explanation = item.explanation.slice(0, 2000); notes.push("The explanation was shortened to 2000 characters."); }

  let kind: Kind = t.kind;
  if (kind === "infer") {
    const tf = options.length === 2 && options.every((o) => parseBool(o) !== null) && new Set(options.map((o) => parseBool(o))).size === 2;
    kind = tf ? "true_false" : options.length >= 2 ? "mcq" : options.length === 1 || c.options.length === 0 ? "short_answer" : "unknown";
    if (kind === "short_answer" && !options.length && !cell(c.correct)) { problems.push("The question type isn't given and there are no options."); }
  }
  if (kind === "mcq") {
    item.type = "mcq"; item.options = options;
    if (options.length < 2) problems.push("A multiple-choice question needs at least two options.");
    else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) problems.push("Two options have the same text.");
    else if (options.some((o) => o.length > 500)) problems.push("An option is longer than 500 characters.");
    if (options.length >= 2) { const r = resolveCorrect(cell(c.correct), slots, compactOf); item.correctIndex = r.index; if (r.problem) problems.push(r.problem); }
  } else if (kind === "true_false") {
    item.type = "true_false";
    const raw = cell(c.correct);
    let b = parseBool(raw);
    if (b === null && /^\d+$/.test(raw)) { const k = Number(raw) - 1; b = k >= 0 && k < slots.length ? parseBool(slots[k] ?? "") : null; }
    item.correctBool = b;
    if (b === null) problems.push(raw ? `The correct answer "${raw}" isn't true or false.` : "No correct answer is given.");
  } else if (kind === "short_answer") {
    item.type = "short_answer";
    const acc = (options.length ? options : cell(c.correct) ? [cell(c.correct)] : []).map((a) => a.trim()).filter(Boolean);
    const firstSpelling = new Map<string, string>();
    for (const a of acc) if (!firstSpelling.has(a.toLowerCase())) firstSpelling.set(a.toLowerCase(), a);
    item.accepted = [...firstSpelling.values()].slice(0, 15);
    if (!item.accepted.length) problems.push("No accepted answer is given.");
    else if (item.accepted.some((a) => a.length > 200)) problems.push("An accepted answer is longer than 200 characters.");
  } else if (kind === "unsupported" || kind === "unknown") item.type = kind === "unsupported" ? "unsupported" : "unknown";

  const marks = cell(c.marks);
  if (marks) { const n = Number(marks); if (Number.isFinite(n) && n > 0 && n <= 100) item.marks = n; else notes.push(`Marks "${marks}" ignored; 1 mark is used.`); }
  const d = cell(c.difficulty).toLowerCase();
  if (["easy", "medium", "hard"].includes(d)) item.difficulty = d;
  const time = cell(c.time);
  if (time) { const n = Number(time); if (Number.isFinite(n) && n > 0) item.timeSec = Math.round(n); }
  if (cell(c.image)) notes.push("An image link was ignored; images aren't imported.");
  return item;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Returns null when no sheet has a recognisable question table. */
export function parseQuestionTable(grids: Grid[]): StoredQuestionTable | null {
  const items: StoredParsedQuestion[] = [];
  let truncated = false; let layout = "Question table";
  for (const g of grids) {
    let h = -1, cols: Cols | null = null;
    for (let i = 0; i < Math.min(15, g.rows.length); i++) { cols = readHeader(g.rows[i] ?? []); if (cols) { h = i; break; } }
    if (!cols) continue;
    const hdr = (g.rows[h] ?? []).map(norm);
    if (hdr.includes("question text") && hdr.includes("question type") && hdr.includes("option 1")) layout = "Wayground / Quizizz export";
    for (let r = h + 1; r < g.rows.length; r++) {
      const cells = g.rows[r] ?? [];
      if (!cells.some((x) => x && x.trim())) continue;
      if (items.length >= LIMITS.questionRows) { truncated = true; break; }
      items.push(parseRow(cells, cols, items.length + 1, r + 1, g.name));
    }
  }
  if (!items.length) return null;
  // Same wording twice inside one file: keep the first.
  const seen = new Set<string>();
  for (const it of items) {
    const k = it.stem.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!k) continue;
    if (seen.has(k)) it.problems.push("This question appears twice in the file.");
    seen.add(k);
  }
  const times = items.filter((i) => !i.problems.length && i.timeSec).map((i) => i.timeSec!);
  const suggestedTimeSec = times.length ? Math.min(300, Math.max(5, Math.round(median(times)))) : null;
  return { layout, items, suggestedTimeSec, truncated };
}
