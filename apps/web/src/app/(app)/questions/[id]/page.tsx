"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { hasPerm, useSession } from "@/lib/session";
import type { Question, Subject } from "@/lib/questions";
import { ErrorNote, Loading, PageHead } from "@/components/ui";
import { QuestionEditor } from "@/components/question-editor";
import { QuestionView, StatusPill } from "@/components/question-view";

export default function QuestionPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useSession();
  const detail = useApi<{ question: Question; versions: { version: number; createdAt: string }[] }>(`/questions/${id}`);
  const schoolId = detail.data?.question.institutionId;
  const subjects = useApi<{ subjects: Subject[] }>(schoolId ? `/institutions/${schoolId}/subjects` : null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status !== "ready") return null;
  const me = state.me;
  if (detail.loading) return <Loading />;
  if (detail.error) return <ErrorNote error={detail.error} retry={detail.reload} />;
  if (!detail.data) return null;
  const { question: q, versions } = detail.data;
  const canWrite = hasPerm(me, "questions.write", q.institutionId);
  const canReview = hasPerm(me, "questions.review", q.institutionId);
  const subject = subjects.data?.subjects.find((s) => s.id === q.subjectId);
  const topic = subject?.topics.find((t) => t.id === q.topicId);

  async function act(path: string, body: unknown | undefined, ok: string) {
    setBusy(true); setMsg(null);
    try {
      await api(`/questions/${id}/${path}`, { method: "POST", body });
      setMsg({ kind: "good", text: ok });
      setNote("");
      await detail.reload();
    } catch (e) { setMsg({ kind: "error", text: describeError(e) }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p><Link href="/questions">← Question bank</Link></p>
      <PageHead title="Question">
        {subject?.name}{topic ? ` · ${topic.name}` : ""}
      </PageHead>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="qcard" aria-label="Question" style={{ maxWidth: "46rem" }}>
        <div className="qcard-head">
          <StatusPill status={q.status} />
          <span className="hint">Version {q.version} · updated {fmtDateTime(q.updatedAt)}</span>
        </div>
        {editing && subjects.data ? (
          <QuestionEditor schoolId={q.institutionId} subjects={subjects.data.subjects} initial={q}
            onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setMsg({ kind: "good", text: "Changes saved." }); void detail.reload(); }} />
        ) : (
          <QuestionView q={q} />
        )}
        {q.reviewNote && <p className="hint">Reviewer's note: {q.reviewNote}</p>}
      </section>

      {!editing && (
        <section className="section" aria-labelledby="act-h">
          <h2 id="act-h">Actions</h2>
          {q.status === "needs_review" && q.source === "ai" && (
            <div className="note" style={{ background: "var(--wait-wash)", borderColor: "#e7cf9b", maxWidth: "46rem" }}>
              <p>This question was written by AI. Check the facts and the answer key yourself before approving it.</p>
            </div>
          )}
          <div className="btn-row">
            {canWrite && q.status !== "archived" && <button className="btn quiet" onClick={() => setEditing(true)}>Edit</button>}
            {canWrite && (q.status === "draft" || q.status === "rejected") && <button className="btn" disabled={busy} onClick={() => void act("submit-for-review", undefined, "Submitted for review.")}>Submit for review</button>}
            {canWrite && q.status !== "archived" && <button className="btn danger" disabled={busy} onClick={() => void act("archive", undefined, "Question archived.")}>Archive</button>}
          </div>
          {canReview && q.status === "needs_review" && (
            <div className="form wide">
              <h3>Review</h3>
              <div className="field">
                <label htmlFor="rv-note">Note <span className="hint">(optional)</span></label>
                <input id="rv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
              <div className="btn-row">
                <button className="btn" disabled={busy} onClick={() => void act("review", { decision: "approve", note: note || undefined }, "Approved. It can now be used in assessments.")}>Approve</button>
                <button className="btn danger" disabled={busy} onClick={() => void act("review", { decision: "reject", note: note || undefined }, "Rejected.")}>Reject</button>
              </div>
            </div>
          )}
          {versions.length > 1 && <p className="hint">Earlier versions are kept: {versions.map((v) => `v${v.version}`).join(", ")}.</p>}
        </section>
      )}
    </>
  );
}
