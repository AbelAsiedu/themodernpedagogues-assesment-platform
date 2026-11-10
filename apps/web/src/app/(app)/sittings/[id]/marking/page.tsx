"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Empty, ErrorNote, Loading, PageHead, Tag } from "@/components/ui";

interface Criterion { point: string; marks: number }
interface Proposal {
  id: string; criteria: { index: number; awarded: number; reason: string }[]; total: number; reasoning: string; missingPoints: string[];
  confidence: "low" | "medium" | "high"; used: boolean; answerChanged: boolean; model: string; at: string;
}
interface Answer {
  sessionId: string; userId: string; fullName: string; text: string;
  mark: { awarded: number; criteria: { index: number; awarded: number }[]; comment: string | null; markedBy: string | null; markedAt: string } | null;
  proposal: Proposal | null;
}
interface Essay { position: number; stem: string; marks: number; rubric: Criterion[]; answers: Answer[] }
interface Queue { sitting: { id: string; title: string }; essays: Essay[]; counts: { answers: number; marked: number; pending: number }; ai: { configured: boolean } }
interface History { events: { at: string; by: string | null; action: "mark" | "adjust"; previous: number | null; awarded: number; reason: string | null; fromAi: boolean }[] }

const num = (n: number) => String(Math.round(n * 100) / 100);

export default function MarkingPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<Queue>(`/sittings/${id}/marking`);
  const [pos, setPos] = useState(0);
  const [hideNames, setHideNames] = useState(false);
  const [filter, setFilter] = useState<"all" | "unmarked">("all");

  if (q.loading && !q.data) return <Loading />;
  if (q.error && !q.data) return <ErrorNote error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  const data = q.data;
  const essay = data.essays[Math.min(pos, Math.max(data.essays.length - 1, 0))];

  return (
    <>
      <p><Link href={`/sittings/${id}`}>← {data.sitting.title}</Link></p>
      <PageHead title="Mark written answers">
        Mark each answer against the rubric. The total is worked out for you. {data.counts.marked} of {data.counts.answers} answers marked.
      </PageHead>

      {!data.essays.length ? <Empty title="No written questions">This exam has no questions that need a person to mark them.</Empty>
        : !data.counts.answers ? <Empty title="Nothing to mark yet">Written answers appear here once students submit.</Empty> : (
        <>
          <div className="btn-row" role="group" aria-label="Marking options">
            <label className="check"><input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} /> Hide student names while marking</label>
            <label className="check"><input type="checkbox" checked={filter === "unmarked"} onChange={(e) => setFilter(e.target.checked ? "unmarked" : "all")} /> Only show unmarked</label>
          </div>
          <nav className="exam-tabs" aria-label="Written questions">
            {data.essays.map((e, i) => {
              const done = e.answers.filter((a) => a.mark).length;
              return <button key={e.position} className={`btn small ${i === pos ? "" : "quiet"}`} aria-current={i === pos ? "page" : undefined} onClick={() => setPos(i)}>Question {e.position + 1} <span className="hint">({done}/{e.answers.length})</span></button>;
            })}
          </nav>
          {essay && (
            <section className="section" aria-labelledby="q-h">
              <h2 id="q-h">Question {essay.position + 1} <span className="hint">· {num(essay.marks)} marks</span></h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{essay.stem}</p>
              <h3>Rubric</h3>
              <ul className="rubric">{essay.rubric.map((c, i) => <li key={i}><span>{c.point}</span><span className="dots" aria-hidden="true" /><span className="m">{num(c.marks)}</span></li>)}</ul>
              {!essay.answers.length && <Empty title="No one answered this question" />}
              {essay.answers.filter((a) => filter === "all" || !a.mark).map((a, i) => (
                <AnswerCard key={a.sessionId + essay.position} essay={essay} answer={a} label={hideNames ? `Candidate ${i + 1}` : a.fullName} aiOn={data.ai.configured} onSaved={q.reload} />
              ))}
              {filter === "unmarked" && essay.answers.length > 0 && essay.answers.every((a) => a.mark) && <p className="hint">Every answer to this question is marked.</p>}
            </section>
          )}
        </>
      )}
    </>
  );
}

function AnswerCard({ essay, answer, label, aiOn, onSaved }: { essay: Essay; answer: Answer; label: string; aiOn: boolean; onSaved: () => Promise<void> | void }) {
  const marked = answer.mark;
  const start = useMemo(() => essay.rubric.map((_, i) => marked?.criteria.find((c) => c.index === i)?.awarded ?? null), [essay.rubric, marked]);
  const [vals, setVals] = useState<(string)[]>(() => start.map((v) => (v === null ? "" : String(v))));
  const [comment, setComment] = useState(marked?.comment ?? "");
  const [reason, setReason] = useState("");
  const [proposalId, setProposalId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [hist, setHist] = useState<History["events"] | null>(null);
  const [editing, setEditing] = useState(!marked);

  const nums = vals.map((v) => (v.trim() === "" ? NaN : Number(v)));
  const bad = nums.map((n, i) => !Number.isFinite(n) || n < 0 || n > essay.rubric[i]!.marks);
  const total = nums.every(Number.isFinite) ? nums.reduce((a, n) => a + n, 0) : null;
  const changing = !!marked;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (bad.some(Boolean)) { setNote({ kind: "error", text: "Each mark must be between 0 and the most that point is worth." }); return; }
    setBusy(true); setNote(null);
    try {
      const r = await api<{ awarded: number; changed: boolean }>(`/exam-sessions/${answer.sessionId}/marks/${essay.position}`, {
        method: "PUT", body: { criteria: nums, comment: comment.trim() || null, basedOn: marked?.awarded ?? null, ...(changing ? { reason } : {}), ...(proposalId ? { proposalId } : {}) },
      });
      setNote({ kind: "good", text: r.changed ? `Saved: ${num(r.awarded)} / ${num(essay.marks)}.` : "Nothing changed." });
      setReason(""); setEditing(false); setHist(null);
      await onSaved();
    } catch (err) { setNote({ kind: "error", text: describeError(err) }); } finally { setBusy(false); }
  }
  async function suggest() {
    setBusy(true); setNote(null);
    try { await api(`/exam-sessions/${answer.sessionId}/marks/${essay.position}/ai-proposal`, { method: "POST" }); await onSaved(); }
    catch (err) { setNote({ kind: "error", text: describeError(err) }); } finally { setBusy(false); }
  }
  async function showHistory() {
    try { setHist((await api<History>(`/exam-sessions/${answer.sessionId}/marks/${essay.position}/history`)).events); }
    catch (err) { setNote({ kind: "error", text: describeError(err) }); }
  }
  function useSuggestion(p: Proposal) {
    setVals(essay.rubric.map((_, i) => String(p.criteria.find((c) => c.index === i)?.awarded ?? "")));
    setProposalId(p.id); setEditing(true);
    setNote({ kind: "good", text: "Suggestion copied into the boxes. Check each one and change anything you disagree with, then save. Nothing is a mark until you save." });
  }

  const p = answer.proposal;
  return (
    <article className="card" aria-label={`Answer by ${label}`} style={{ marginTop: "1.25rem" }}>
      <header className="btn-row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{label}</h3>
        {marked ? <Tag tone="ok">marked {num(marked.awarded)} / {num(essay.marks)}</Tag> : <Tag tone="wait">not marked</Tag>}
      </header>
      <blockquote className="answer-text" style={{ whiteSpace: "pre-wrap", margin: "0.75rem 0", padding: "0.6rem 0.9rem", borderLeft: "4px solid var(--rule)" }}>{answer.text}</blockquote>

      {!marked && aiOn && !p && <p><button type="button" className="btn small quiet" disabled={busy} onClick={() => void suggest()}>Get an AI suggestion</button> <span className="hint">Optional. Sends this answer's text (not the student's name) to the AI service. It only suggests; you decide.</span></p>}
      {!marked && p && (
        <div className="note" role="region" aria-label="AI suggestion">
          <p><strong>AI suggestion (not a mark): {num(p.total)} / {num(essay.marks)}</strong> · confidence {p.confidence}</p>
          {p.answerChanged && <p className="hint">The answer has changed since this suggestion was made.</p>}
          <ul>{p.criteria.map((c) => <li key={c.index}>{essay.rubric[c.index]?.point}: <b>{num(c.awarded)}</b> / {num(essay.rubric[c.index]?.marks ?? 0)}. {c.reason}</li>)}</ul>
          {p.reasoning && <p>{p.reasoning}</p>}
          {p.missingPoints.length > 0 && <p className="hint">Not covered: {p.missingPoints.join("; ")}</p>}
          <p><button type="button" className="btn small" onClick={() => useSuggestion(p)}>Copy into the marking boxes</button></p>
          <p className="hint">Suggestions can be wrong. Students never see this.</p>
        </div>
      )}

      {marked && !editing ? (
        <>
          <ul className="rubric">{essay.rubric.map((c, i) => <li key={i}><span>{c.point}</span><span className="dots" aria-hidden="true" /><span className="m">{num(start[i] ?? 0)} / {num(c.marks)}</span></li>)}</ul>
          {marked.comment && <p><strong>Comment to student:</strong> {marked.comment}</p>}
          <p className="hint">Marked{marked.markedBy ? ` by ${marked.markedBy}` : ""} {fmtDateTime(marked.markedAt)}</p>
          <div className="btn-row">
            <button className="btn small quiet" onClick={() => setEditing(true)}>Change this mark</button>
            <button className="btn small quiet" onClick={() => void showHistory()}>History</button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void save(e)} noValidate>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">Marks for {label}</legend>
            {essay.rubric.map((c, i) => (
              <div key={i} className="field" style={{ display: "flex", gap: "0.6rem", alignItems: "center", margin: "0.35rem 0" }}>
                <label htmlFor={`m-${answer.sessionId}-${i}`} style={{ flex: 1 }}>{c.point}</label>
                <input id={`m-${answer.sessionId}-${i}`} inputMode="decimal" style={{ width: "5rem" }} value={vals[i]} aria-invalid={vals[i] !== "" && bad[i]} onChange={(e) => setVals(vals.map((v, j) => (j === i ? e.target.value : v)))} />
                <span aria-hidden="true">/ {num(c.marks)}</span>
              </div>
            ))}
          </fieldset>
          <p><strong>Total: {total === null ? "—" : num(total)} / {num(essay.marks)}</strong></p>
          <div className="field">
            <label htmlFor={`c-${answer.sessionId}`}>Comment to the student <span className="hint">(optional, shown to the student after results are released)</span></label>
            <textarea id={`c-${answer.sessionId}`} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {changing && (
            <div className="field">
              <label htmlFor={`r-${answer.sessionId}`}>Why are you changing this mark? <span className="hint">(recorded in the history)</span></label>
              <input id={`r-${answer.sessionId}`} required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <div className="btn-row">
            <button className="btn" disabled={busy || total === null || bad.some(Boolean) || (changing && reason.trim().length < 5)}>{changing ? "Save the change" : "Save mark"}</button>
            {changing && <button type="button" className="btn quiet" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      )}
      {note && <div className={`note ${note.kind}`} role={note.kind === "error" ? "alert" : "status"}><p>{note.text}</p></div>}
      {hist && (
        <div className="table-wrap"><table>
          <caption className="sr-only">Mark history</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Change</th><th scope="col">Reason</th></tr></thead>
          <tbody>{hist.map((h, i) => <tr key={i}><td>{fmtDateTime(h.at)}</td><td>{h.by ?? "—"}</td><td>{h.previous === null ? `marked ${num(h.awarded)}` : `${num(h.previous)} → ${num(h.awarded)}`}{h.fromAi ? " (started from AI suggestion)" : ""}</td><td>{h.reason ?? "—"}</td></tr>)}</tbody>
        </table></div>
      )}
    </article>
  );
}
