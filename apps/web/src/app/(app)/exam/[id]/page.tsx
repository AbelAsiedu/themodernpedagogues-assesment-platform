"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { ErrorNote, Loading, PageHead } from "@/components/ui";

interface Item { position: number; type: string; stem: string; marks: number; options?: { id: string; text: string }[] }
interface Section { position: number; title: string; instructions: string | null; rule: { type: string; count?: number }; ruleText: string; items: Item[] }
interface View {
  session: { id: string; status: string; deadlineAt: string; serverNow: string; remainingMs: number };
  sitting: { id: string; title: string; instructions: string | null; durationMinutes: number; resultsReleased: boolean };
  sections: Section[];
  responses: Record<string, { seq: number; answer: unknown }>;
  submission: { receipt: string; submittedAt: string; kind: string; answeredCount: number } | null;
}
type Ans = { optionId: string } | { value: boolean } | { text: string } | null;
type Saving = "saved" | "saving" | "offline";

const isAnswered = (a: unknown) => {
  if (!a) return false;
  const x = a as Record<string, unknown>;
  return "text" in x ? String(x.text).trim().length > 0 : "optionId" in x || "value" in x;
};
const storeKey = (id: string) => `tmp.exam.${id}`;
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };

export default function ExamRoom() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<Record<number, Ans>>({});
  const [saving, setSaving] = useState<Saving>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [left, setLeft] = useState(0);
  const [announce, setAnnounce] = useState("");

  // ---- save engine: every change gets a higher sequence number; unsent changes survive a refresh and a bad connection.
  const seq = useRef<Record<number, number>>({});
  const dirty = useRef<Record<number, { seq: number; answer: Ans }>>({});
  const sending = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const offset = useRef(0);
  const ended = useRef(false);

  const persist = () => { try { localStorage.setItem(storeKey(id), JSON.stringify(dirty.current)); } catch { /* storage unavailable: the server copy still works */ } };

  const load = useCallback(async () => {
    try {
      const v = await api<View>(`/exam-sessions/${id}`);
      offset.current = Date.parse(v.session.serverNow) - Date.now();
      setDeadline(Date.parse(v.session.deadlineAt));
      ended.current = v.session.status !== "in_progress";
      for (const [p, r] of Object.entries(v.responses)) seq.current[Number(p)] = Math.max(seq.current[Number(p)] ?? 0, r.seq);
      setView(v); setError(null);
      setAnswers((cur) => {
        const next: Record<number, Ans> = { ...cur };
        for (const [p, r] of Object.entries(v.responses)) if (!(Number(p) in dirty.current)) next[Number(p)] = r.answer as Ans;
        return next;
      });
      return v;
    } catch (e) { setError(e); return null; }
  }, [id]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let failed = false;
    try {
      for (const [p, e] of Object.entries(dirty.current)) {
        setSaving("saving");
        try {
          await api(`/exam-sessions/${id}/responses/${p}`, { method: "PUT", body: { seq: e.seq, answer: e.answer } });
          if (dirty.current[Number(p)]?.seq === e.seq) delete dirty.current[Number(p)]; // a newer edit stays queued
          persist();
        } catch (err) {
          if (err instanceof ApiError && (err.code === "time_up" || err.code === "exam_submitted")) { dirty.current = {}; persist(); ended.current = true; void load(); return; }
          if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) { delete dirty.current[Number(p)]; persist(); setProblem(`One answer could not be saved: ${err.message}`); continue; }
          throw err; // offline, server error or rate limit: keep it and retry
        }
      }
    } catch { failed = true; } finally { sending.current = false; }
    if (failed) {
      setSaving("offline"); attempt.current++;
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => void flush(), Math.min(15_000, 1000 * 2 ** attempt.current));
    } else {
      attempt.current = 0;
      if (Object.keys(dirty.current).length) void flush(); else setSaving("saved");
    }
  }, [id, load]);

  const change = (pos: number, answer: Ans, soon = false) => {
    if (ended.current) return;
    const next = (seq.current[pos] ?? 0) + 1;
    seq.current[pos] = next;
    dirty.current[pos] = { seq: next, answer };
    persist();
    setAnswers((a) => ({ ...a, [pos]: answer }));
    setSaving("saving"); setProblem(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (soon) void flush(); else debounce.current = setTimeout(() => void flush(), 700);
  };

  // first load, then re-send anything a refresh or a dropped connection left unsaved
  useEffect(() => {
    void (async () => {
      const v = await load();
      if (!v || v.session.status !== "in_progress") return;
      try {
        const stored = JSON.parse(localStorage.getItem(storeKey(id)) ?? "{}") as Record<string, { seq: number; answer: Ans }>;
        for (const [p, e] of Object.entries(stored)) {
          if (e.seq > (v.responses[p]?.seq ?? 0)) { dirty.current[Number(p)] = e; seq.current[Number(p)] = Math.max(seq.current[Number(p)] ?? 0, e.seq); setAnswers((a) => ({ ...a, [Number(p)]: e.answer })); }
        }
        if (Object.keys(dirty.current).length) void flush();
      } catch { /* nothing stored */ }
    })();
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(dirty.current).length) { e.preventDefault(); } };
    const hide = () => { if (document.visibilityState === "hidden" && Object.keys(dirty.current).length) void flush(); };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("visibilitychange", hide); if (retry.current) clearTimeout(retry.current); if (debounce.current) clearTimeout(debounce.current); };
  }, [id, load, flush]);

  async function submit(timeUp = false) {
    setSubmitting(true); setProblem(null);
    if (debounce.current) clearTimeout(debounce.current);
    await flush();
    if (Object.keys(dirty.current).length && !ended.current) {
      setProblem("Your latest answers haven't reached the server yet. Check your connection; they will keep retrying. Then press Submit again.");
      setSubmitting(false); return;
    }
    try { await api(`/exam-sessions/${id}/submit`, { method: "POST", body: { timeUp } }); ended.current = true; try { localStorage.removeItem(storeKey(id)); } catch { /* fine */ } await load(); setReviewing(false); }
    catch (e) { setProblem(describeError(e)); } finally { setSubmitting(false); }
  }

  // ---- the clock. The server owns it: this only draws it, and re-syncs often (also picks up extra time granted by staff).
  const submitRef = useRef(submit); submitRef.current = submit;
  const warned = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!view || view.session.status !== "in_progress") return;
    const t = setInterval(() => {
      const ms = deadline - (Date.now() + offset.current);
      setLeft(ms);
      for (const m of [10, 5, 1]) if (ms <= m * 60_000 && !warned.current.has(m)) { warned.current.add(m); setAnnounce(`${m} minute${m === 1 ? "" : "s"} remaining`); }
      if (ms <= 0 && !ended.current) { ended.current = true; void submitRef.current(true); }
    }, 500);
    const sync = setInterval(() => void load(), 30_000);
    return () => { clearInterval(t); clearInterval(sync); };
  }, [view?.session.status, deadline, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const [result, setResult] = useState<{ released: boolean; totalAwarded?: number; totalMax?: number; markingComplete?: boolean; sections?: { title: string; awarded: number; max: number; pending: number }[] } | null>(null);
  useEffect(() => { if (view?.submission && view.sitting.resultsReleased) void api<NonNullable<typeof result>>(`/exam-sessions/${id}/result`).then(setResult).catch(() => {}); }, [view?.submission, view?.sitting.resultsReleased, id]);

  const all = useMemo(() => view?.sections.flatMap((s) => s.items) ?? [], [view]);
  if (error && !view) return <ErrorNote error={error} retry={() => void load()} />;
  if (!view) return <Loading />;

  /* ----------------------------------------------------------- finished */
  if (view.session.status !== "in_progress" && view.submission) {
    return (
      <>
        <PageHead title={view.sitting.title}>Submitted.</PageHead>
        <div className="note good" role="status">
          <p><strong>Your answers are in.</strong> {view.submission.kind === "auto" ? "Time ran out, so your saved answers were submitted automatically." : "You submitted your exam."}</p>
          <p>Receipt: <code className="receipt">{view.submission.receipt}</code> · {fmtDateTime(view.submission.submittedAt)} · {view.submission.answeredCount} of {all.length} questions answered</p>
          <p className="hint">Keep your receipt. It proves what was received.</p>
        </div>
        {result?.released ? (
          <section className="section" aria-labelledby="res-h">
            <h2 id="res-h">Your result</h2>
            <div className="stat-row"><div className="stat"><b>{result.totalAwarded}/{result.totalMax}</b><span>marks so far</span></div></div>
            {!result.markingComplete && <p className="hint">Some written answers haven't been marked yet, so this total will rise.</p>}
            <div className="table-wrap"><table><caption className="sr-only">Marks by section</caption>
              <thead><tr><th scope="col">Section</th><th scope="col">Marks</th></tr></thead>
              <tbody>{result.sections?.map((s) => <tr key={s.title}><td>{s.title}</td><td>{s.awarded}/{s.max}{s.pending ? ` (${s.pending} waiting to be marked)` : ""}</td></tr>)}</tbody></table></div>
          </section>
        ) : <p>Results will appear here when your teacher releases them.</p>}
        <p><Link href="/my-exams">← My exams</Link></p>
      </>
    );
  }

  /* ------------------------------------------------------------- the room */
  const cur = view.sections[tab]!;
  const counts = view.sections.map((s) => ({ s, n: s.items.filter((i) => isAnswered(answers[i.position])).length }));
  const low = left > 0 && left <= 5 * 60_000;

  return (
    <>
      <div className="exam-bar" role="region" aria-label="Exam status">
        <div><strong>{view.sitting.title}</strong></div>
        <div className={`exam-clock ${low ? "low" : ""}`} aria-label="Time left" role="timer">{mmss(left || view.session.remainingMs)}</div>
        <div className={`save-state ${saving}`} role="status">{saving === "saved" ? "All answers saved" : saving === "saving" ? "Saving…" : "Not saved yet. Retrying…"}</div>
      </div>
      <div className="sr-only" aria-live="assertive">{announce}</div>
      {saving === "offline" && <div className="note error" role="alert"><p>Your connection seems to be down. Keep working: your answers are kept on this device and will be sent as soon as it is back. Don't close this page.</p></div>}
      {problem && <div className="note error" role="alert"><p>{problem}</p></div>}

      {!reviewing ? (
        <>
          {view.sitting.instructions && tab === 0 && <p className="hint">{view.sitting.instructions}</p>}
          <nav className="exam-tabs" aria-label="Sections">
            {counts.map(({ s, n }, i) => (
              <button key={s.position} className={`btn small ${i === tab ? "" : "quiet"}`} aria-current={i === tab ? "page" : undefined} onClick={() => setTab(i)}>{s.title} <span className="hint">({n}/{s.items.length})</span></button>
            ))}
          </nav>
          <section className="section" aria-labelledby="sec-h">
            <h2 id="sec-h">{cur.title}</h2>
            <p><strong>{cur.ruleText}</strong>{cur.instructions ? ` ${cur.instructions}` : ""}</p>
            {cur.rule.type === "answer_any" && counts[tab]!.n > cur.rule.count! && <div className="note error"><p>You have answered {counts[tab]!.n} questions here. Only the best {cur.rule.count} will be counted.</p></div>}
            <ol className="exam-qs" start={cur.items[0]?.position! + 1}>
              {cur.items.map((q) => <Question key={q.position} q={q} value={answers[q.position] ?? null} onChange={(a, soon) => change(q.position, a, soon)} />)}
            </ol>
          </section>
          <div className="btn-row">
            {tab > 0 && <button className="btn quiet" onClick={() => setTab(tab - 1)}>← Previous section</button>}
            {tab < view.sections.length - 1 ? <button className="btn" onClick={() => setTab(tab + 1)}>Next section →</button> : null}
            <button className="btn" onClick={() => setReviewing(true)}>Review and submit</button>
          </div>
        </>
      ) : (
        <section className="section" aria-labelledby="rev-h">
          <h2 id="rev-h">Before you submit</h2>
          <ul>
            {counts.map(({ s, n }) => <li key={s.position}>{s.title}: <strong>{n}</strong> of {s.items.length} answered{s.rule.type === "answer_any" ? ` (answer any ${s.rule.count})` : ""}</li>)}
          </ul>
          {(() => { const open = all.filter((q) => !isAnswered(answers[q.position])).length; return open > 0 && <p className="hint">{open} question{open === 1 ? " is" : "s are"} unanswered. In an "answer any" section you only need to answer the number asked for.</p>; })()}
          <p>When you submit you can't change your answers.</p>
          <div className="btn-row">
            <button className="btn bigbtn" disabled={submitting} onClick={() => void submit(false)}>{submitting ? "Submitting…" : "Submit exam"}</button>
            <button className="btn quiet" disabled={submitting} onClick={() => setReviewing(false)}>Keep working</button>
          </div>
        </section>
      )}
    </>
  );
}

function Question({ q, value, onChange }: { q: Item; value: Ans; onChange(a: Ans, soon?: boolean): void }) {
  const name = `q${q.position}`;
  return (
    <li className="exam-q" value={q.position + 1}>
      <p className="stem">{q.stem} <span className="hint">[{q.marks} mark{q.marks === 1 ? "" : "s"}]</span></p>
      {q.type === "mcq" && (
        <fieldset className="choices"><legend className="sr-only">Choose one answer</legend>
          {q.options!.map((o, i) => (
            <label key={o.id} className="choice"><input type="radio" name={name} checked={!!value && "optionId" in value && value.optionId === o.id} onChange={() => onChange({ optionId: o.id }, true)} /> <span className="letter">{"ABCDEF"[i]}</span> {o.text}</label>
          ))}
          {value && <button type="button" className="btn small quiet" onClick={() => onChange(null, true)}>Clear answer</button>}
        </fieldset>
      )}
      {q.type === "true_false" && (
        <fieldset className="choices"><legend className="sr-only">True or false</legend>
          {[true, false].map((v) => <label key={String(v)} className="choice"><input type="radio" name={name} checked={!!value && "value" in value && value.value === v} onChange={() => onChange({ value: v }, true)} /> {v ? "True" : "False"}</label>)}
          {value && <button type="button" className="btn small quiet" onClick={() => onChange(null, true)}>Clear answer</button>}
        </fieldset>
      )}
      {q.type === "short_answer" && (
        <div className="field"><label htmlFor={name} className="sr-only">Your answer</label><input id={name} value={value && "text" in value ? value.text : ""} maxLength={200} autoComplete="off" onChange={(e) => onChange({ text: e.target.value })} onBlur={() => onChange(value && "text" in value ? value : null, true)} /></div>
      )}
      {q.type === "essay" && (
        <div className="field"><label htmlFor={name} className="sr-only">Your answer</label>
          <textarea id={name} rows={8} maxLength={10000} value={value && "text" in value ? value.text : ""} onChange={(e) => onChange({ text: e.target.value })} />
          <span className="hint">{value && "text" in value ? value.text.length : 0} / 10,000 characters</span></div>
      )}
    </li>
  );
}
