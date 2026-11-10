"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Empty, ErrorNote, Loading, PageHead, Tag } from "@/components/ui";

interface Student {
  userId: string; fullName: string; status: "not_started" | "in_progress" | "timed_out" | "submitted"; sessionId: string | null; startedAt: string | null; deadlineAt: string | null;
  extensionMinutes: number; answered: number; submittedAt: string | null; submitKind: string | null; lastSavedAt: string | null;
}
interface Room {
  sitting: { id: string; title: string; opensAt: string; closesAt: string; durationMinutes: number; phase: string; resultsReleasedAt: string | null };
  serverNow: string; totalQuestions: number; students: Student[];
  counts: { expected: number; notStarted: number; inProgress: number; submitted: number };
}
interface Results { results: { sessionId: string; fullName: string; awarded: number; max: number; pendingItems: number }[] }

const LABEL: Record<Student["status"], string> = { not_started: "not started", in_progress: "working", timed_out: "time up", submitted: "submitted" };

export default function SittingPage() {
  const { id } = useParams<{ id: string }>();
  const room = useApi<Room>(`/sittings/${id}`);
  const results = useApi<Results>(`/sittings/${id}/results`);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [extending, setExtending] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // The control room refreshes itself while the exam is on.
  const phase = room.data?.sitting.phase;
  useEffect(() => {
    if (phase !== "open" && phase !== "upcoming") return;
    const t = setInterval(() => void room.reload(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, id]);

  async function act(path: string, body?: unknown, ok?: string) {
    setBusy(true); setMsg(null);
    try { await api(path, { method: "POST", body }); setMsg(ok ? { kind: "good", text: ok } : null); await room.reload(); await results.reload(); setExtending(null); }
    catch (e) { setMsg({ kind: "error", text: describeError(e) }); } finally { setBusy(false); }
  }
  async function extend(sessionId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(`/exam-sessions/${sessionId}/extend`, { minutes: Number(f.get("minutes")), reason: String(f.get("reason")) }, "Extra time granted and recorded.");
  }

  if (room.loading && !room.data) return <Loading />;
  if (room.error && !room.data) return <ErrorNote error={room.error} retry={room.reload} />;
  if (!room.data) return null;
  const r = room.data;
  const s = r.sitting;
  const closed = s.phase === "closed";

  return (
    <>
      <p><Link href="/exams">← Exams</Link></p>
      <PageHead title={s.title}>
        {s.phase === "upcoming" ? `Opens ${fmtDateTime(s.opensAt)}.` : s.phase === "open" ? `Open until ${fmtDateTime(s.closesAt)}.` : s.phase === "cancelled" ? "Cancelled." : `Closed ${fmtDateTime(s.closesAt)}.`}
        {" "}{s.durationMinutes} minutes each · {r.totalQuestions} questions.
      </PageHead>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="section" aria-label="Counts" aria-live="polite">
        <div className="stat-row">
          <div className="stat"><b>{r.counts.expected}</b><span>expected</span></div>
          <div className="stat"><b>{r.counts.notStarted}</b><span>not started</span></div>
          <div className="stat"><b>{r.counts.inProgress}</b><span>working</span></div>
          <div className="stat"><b>{r.counts.submitted}</b><span>submitted</span></div>
        </div>
        <div className="btn-row">
          {closed && !s.resultsReleasedAt && <button className="btn" disabled={busy} onClick={() => void act(`/sittings/${id}/release-results`, undefined, "Results released to students.")}>Release results to students</button>}
          {s.resultsReleasedAt && <span className="pill ok">Results released {fmtDateTime(s.resultsReleasedAt)}</span>}
          {r.counts.inProgress + r.counts.submitted === 0 && s.phase !== "cancelled" && !confirmCancel && <button className="btn danger" onClick={() => setConfirmCancel(true)}>Cancel this exam</button>}
          {confirmCancel && <><strong role="alert">Cancel for everyone?</strong><button className="btn danger" disabled={busy} onClick={() => { setConfirmCancel(false); void act(`/sittings/${id}/cancel`, undefined, "Exam cancelled."); }}>Yes, cancel</button><button className="btn quiet" onClick={() => setConfirmCancel(false)}>Keep it</button></>}
        </div>
        {!closed && <p className="hint">Results can be released after the exam closes. Students see only a receipt until then.</p>}
      </section>

      <section className="section" aria-labelledby="st-h">
        <h2 id="st-h">Candidates</h2>
        {!r.students.length ? <Empty title="No students expected">Add students to the class, or to the school, to see them here.</Empty> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Candidates and their progress</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Answered</th><th scope="col">Deadline</th><th scope="col">Submitted</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{r.students.map((x) => (
              <tr key={x.userId}>
                <td>{x.fullName}</td>
                <td><Tag tone={x.status === "submitted" ? "ok" : x.status === "in_progress" ? "wait" : x.status === "timed_out" ? "wait" : "plain"}>{LABEL[x.status]}{x.submitKind === "auto" ? " (auto)" : ""}</Tag></td>
                <td>{x.sessionId ? `${x.answered}/${r.totalQuestions}` : "—"}</td>
                <td>{x.deadlineAt ? fmtDateTime(x.deadlineAt) : "—"}{x.extensionMinutes ? ` (+${x.extensionMinutes} min)` : ""}</td>
                <td>{x.submittedAt ? fmtDateTime(x.submittedAt) : "—"}</td>
                <td>
                  {x.status === "in_progress" && x.sessionId && extending !== x.sessionId && <button className="btn small quiet" onClick={() => setExtending(x.sessionId)}>Give extra time</button>}
                  {extending === x.sessionId && x.sessionId && (
                    <form className="inline-form" onSubmit={(e) => void extend(x.sessionId!, e)}>
                      <label className="sr-only" htmlFor={`m-${x.userId}`}>Extra minutes</label>
                      <input id={`m-${x.userId}`} name="minutes" type="number" min={1} max={120} defaultValue={10} required style={{ width: "5rem" }} />
                      <label className="sr-only" htmlFor={`r-${x.userId}`}>Reason</label>
                      <input id={`r-${x.userId}`} name="reason" required minLength={5} maxLength={300} placeholder="Reason (recorded)" />
                      <button className="btn small" disabled={busy}>Grant</button>
                      <button type="button" className="btn small quiet" onClick={() => setExtending(null)}>Cancel</button>
                    </form>
                  )}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" aria-labelledby="rs-h">
        <h2 id="rs-h">Marks so far</h2>
        <p className="hint">Multiple-choice, true/false and short-answer questions are marked automatically after submission. Essays wait for a person to mark them (not built yet), so totals exclude them.</p>
        {results.loading ? <Loading /> : results.error ? <ErrorNote error={results.error} retry={results.reload} /> : !results.data?.results.length ? <Empty title="No submissions yet" /> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Marks by candidate</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Marks</th><th scope="col">Waiting for a marker</th></tr></thead>
            <tbody>{results.data.results.map((x) => <tr key={x.sessionId}><td>{x.fullName}</td><td>{x.awarded} / {x.max}</td><td>{x.pendingItems ? `${x.pendingItems} answer${x.pendingItems === 1 ? "" : "s"}` : "—"}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
