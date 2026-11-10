"use client";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { DIFFICULTIES, MAX_QUESTIONS_PER_REQUEST, MAX_SOURCE_TEXT, QUESTION_TYPES, QUESTION_TYPE_LABEL, type QuestionType } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import type { Question, Subject } from "@/lib/questions";
import type { UploadSummary } from "@/lib/uploads";
import { Empty, ErrorNote, Loading, PageHead } from "@/components/ui";
import { SchoolPicker, useSchoolChoice } from "@/components/school-picker";
import { QuestionView, StatusPill } from "@/components/question-view";
import { fmtDateTime } from "@/lib/format";
import { hasPerm, useSession } from "@/lib/session";

interface Status { configured: boolean; provider: string | null; model: string | null; dailyLimitPerUser: number; usedLast24h: number }
interface Gen { id: string; status: string; model: string; requestedCount: number; savedCount: number; rejectedCount: number; createdAt: string; error: string | null }

export default function StudioPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return <Suspense fallback={<Loading />}><StudioInner /></Suspense>;
}

function StudioInner() {
  const { state } = useSession();
  const { schools, loading, schoolId, choose } = useSchoolChoice("ai.generate");
  if (state.status !== "ready") return null;
  if (loading) return <Loading />;
  if (!schools.length) return (
    <>
      <PageHead title="AI Question Studio" />
      <Empty title="Not available for your account">Teachers and school administrators can use the AI Question Studio.</Empty>
    </>
  );
  return (
    <>
      <PageHead title="AI Question Studio">AI writes draft questions for you to check. Nothing it writes can be used until a teacher approves it.</PageHead>
      <SchoolPicker schools={schools} value={schoolId} onChange={choose} />
      {schoolId && <Studio key={schoolId} schoolId={schoolId} />}
    </>
  );
}

function Studio({ schoolId }: { schoolId: string }) {
  const { state } = useSession();
  const me = state.status === "ready" ? state.me : null;
  const status = useApi<Status>(`/institutions/${schoolId}/ai/status`);
  const subjects = useApi<{ subjects: Subject[] }>(`/institutions/${schoolId}/subjects`);
  const gens = useApi<{ generations: Gen[] }>(`/institutions/${schoolId}/ai/generations`);
  const files = useApi<{ uploads: UploadSummary[] }>(`/institutions/${schoolId}/uploads`);
  const wantedUpload = useSearchParams().get("upload") ?? "";
  const [uploadId, setUploadId] = useState(wantedUpload);
  const [parts, setParts] = useState<Set<string>>(new Set());
  const [noteLen, setNoteLen] = useState(0);
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ questions: Question[]; rejected: { reason: string }[] } | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  if (!me) return null;
  const canReview = hasPerm(me, "questions.review", schoolId);
  const subs = subjects.data?.subjects ?? [];
  const chosen = subs.find((s) => s.id === (subjectId || subs[0]?.id));
  const file = files.data?.uploads.find((x) => x.id === uploadId);
  const partChars = (file?.sections ?? []).filter((x) => parts.has(x.id)).reduce((n, x) => n + x.chars, 0);
  const grounded = partChars + (partChars && noteLen ? noteLen + 2 : noteLen);
  const overLimit = !!file && grounded > MAX_SOURCE_TEXT;
  const togglePart = (id: string) => setParts((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setResults(null); setDone({});
    try {
      const r = await api<{ questions: Question[]; rejected: { reason: string }[] }>(`/institutions/${schoolId}/ai/generate-questions`, {
        method: "POST",
        body: {
          subjectId: chosen?.id, topicId: f.get("topicId") || null, type: f.get("type"), count: Number(f.get("count")),
          difficulty: f.get("difficulty"), level: f.get("level"),
          sourceText: String(f.get("sourceText") ?? "").trim() || undefined, focus: String(f.get("focus") ?? "").trim() || undefined,
          ...(file ? { uploadId: file.id, sectionIds: [...parts] } : {}),
        },
      });
      setResults(r);
    } catch (err) { setError(describeError(err)); }
    finally { setBusy(false); void status.reload(); void gens.reload(); }
  }

  async function decide(q: Question, decision: "approve" | "reject") {
    try {
      await api(`/questions/${q.id}/review`, { method: "POST", body: { decision } });
      setDone((d) => ({ ...d, [q.id]: decision === "approve" ? "Approved" : "Rejected" }));
    } catch (err) { setDone((d) => ({ ...d, [q.id]: describeError(err) })); }
  }

  const s = status.data;
  return (
    <>
      {status.loading ? <Loading /> : status.error ? <ErrorNote error={status.error} retry={status.reload} /> : s && !s.configured ? (
        <div className="note error" role="status"><p>AI generation isn't set up on this server yet. An administrator needs to add the AI provider key to the server configuration.</p></div>
      ) : s && (
        <p className="hint">Model: {s.model} · You've used {s.usedLast24h} of {s.dailyLimitPerUser} requests in the last 24 hours.</p>
      )}

      <section className="section" aria-labelledby="gen-h">
        <h2 id="gen-h">Generate questions</h2>
        {subjects.loading ? <Loading /> : !subs.length ? (
          <Empty title="Add a subject first">Subjects and topics are set up in the <Link href="/questions">Question bank</Link>.</Empty>
        ) : (
          <form className="form wide" onSubmit={(e) => void generate(e)}>
            <div className="row2">
              <div className="field"><label htmlFor="g-sub">Subject</label>
                <select id="g-sub" value={chosen?.id ?? ""} onChange={(e) => setSubjectId(e.target.value)}>
                  {subs.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.level})</option>)}
                </select></div>
              <div className="field"><label htmlFor="g-topic">Topic</label>
                <select id="g-topic" name="topicId" defaultValue="" key={chosen?.id}>
                  <option value="">Any topic</option>{chosen?.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="g-type">Question type</label>
                <select id="g-type" name="type" defaultValue="mcq">{QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t as QuestionType]}</option>)}</select></div>
              <div className="field"><label htmlFor="g-count">How many (1–{MAX_QUESTIONS_PER_REQUEST})</label>
                <input id="g-count" name="count" type="number" min={1} max={MAX_QUESTIONS_PER_REQUEST} defaultValue={5} required /></div>
            </div>
            <div className="row2">
              <div className="field"><label htmlFor="g-diff">Difficulty</label>
                <select id="g-diff" name="difficulty" defaultValue="medium">{DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
              <div className="field"><label htmlFor="g-level">Class level</label>
                <input id="g-level" name="level" defaultValue={chosen?.level ?? "JHS 3"} required maxLength={40} /></div>
            </div>
            <div className="field"><label htmlFor="g-focus">Focus <span className="hint">(optional)</span></label>
              <input id="g-focus" name="focus" maxLength={300} placeholder="e.g. causes and effects of ethnic conflict" /></div>
            <div className="field"><label htmlFor="g-file">A file you've uploaded <span className="hint">(optional)</span></label>
              <select id="g-file" value={uploadId} onChange={(e) => { setUploadId(e.target.value); setParts(new Set()); }}>
                <option value="">None: use my notes below or the syllabus only</option>
                {files.data?.uploads.filter((x) => x.sections.length).map((x) => <option key={x.id} value={x.id}>{x.filename}</option>)}
              </select>
              <span className="hint">Add files on the <Link href="/uploads">Import files</Link> page.</span></div>
            {file && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend>Which parts should the questions be based on?</legend>
                <div className="check-list">
                  {file.sections.map((x) => (
                    <label key={x.id}>
                      <input type="checkbox" checked={parts.has(x.id)} onChange={() => togglePart(x.id)} />
                      <span><strong>{x.label}</strong> <span className="hint">({x.chars.toLocaleString("en-GH")} characters{x.ocr ? ", read from a picture, so check it" : ""})</span><br /><span className="hint">{x.preview}…</span></span>
                    </label>
                  ))}
                </div>
                <span className={`sec-count${overLimit ? " over" : ""}`} aria-live="polite">{grounded.toLocaleString("en-GH")} of {MAX_SOURCE_TEXT.toLocaleString("en-GH")} characters chosen{overLimit ? ". Choose fewer parts." : ""}</span>
                {file.warnings.map((w) => <span className="hint" key={w}>{w}</span>)}
              </fieldset>
            )}
            <div className="field"><label htmlFor="g-src">Your notes <span className="hint">(optional)</span></label>
              <textarea id="g-src" name="sourceText" rows={5} maxLength={MAX_SOURCE_TEXT} onChange={(e) => setNoteLen(e.target.value.trim().length)} />
              <span className="hint">Paste your own lesson notes and the questions will be based only on them. Use notes you wrote or have the right to use. Up to {MAX_SOURCE_TEXT.toLocaleString()} characters.</span></div>
            <div className="btn-row"><button className="btn" type="submit" disabled={busy || overLimit || (!!file && !parts.size) || (s ? !s.configured : false)}>{busy ? "Writing questions… this can take up to a minute" : "Generate drafts"}</button></div>
          </form>
        )}
        {error && <div className="note error" role="alert"><p>{error}</p></div>}
      </section>

      {results && (
        <section className="section" aria-labelledby="res-h" aria-live="polite">
          <h2 id="res-h">Drafts to check ({results.questions.length})</h2>
          <p className="hint">Read each question and its answer key. Approve only what you'd be happy to give your students.{results.rejected.length ? ` ${results.rejected.length} item(s) from the AI were discarded because they were invalid or duplicates.` : ""}</p>
          <div className="stack">
            {results.questions.map((q) => (
              <article className={`qcard ${done[q.id] === "Approved" ? "approved" : done[q.id] === "Rejected" ? "rejected" : "needs_review"}`} key={q.id}>
                <div className="qcard-head"><StatusPill status={done[q.id] === "Approved" ? "approved" : done[q.id] === "Rejected" ? "rejected" : q.status} /><Link href={`/questions/${q.id}`}>Open to edit</Link></div>
                <QuestionView q={q} />
                {done[q.id] ? <p role="status"><strong>{done[q.id]}</strong></p> : canReview && (
                  <div className="btn-row">
                    <button className="btn small" onClick={() => void decide(q, "approve")}>Approve</button>
                    <button className="btn small danger" onClick={() => void decide(q, "reject")}>Reject</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="log-h">
        <h2 id="log-h">Recent requests</h2>
        {gens.loading ? <Loading /> : gens.error ? <ErrorNote error={gens.error} retry={gens.reload} /> : !gens.data?.generations.length ? <Empty title="Nothing generated yet" /> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Recent AI requests</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Result</th><th scope="col">Asked</th><th scope="col">Kept</th><th scope="col">Discarded</th></tr></thead>
            <tbody>{gens.data.generations.slice(0, 10).map((g) => (
              <tr key={g.id}><td>{fmtDateTime(g.createdAt)}</td><td>{g.status === "succeeded" ? "Succeeded" : `Failed${g.error ? ` (${g.error.split(":")[0]})` : ""}`}</td><td>{g.requestedCount}</td><td>{g.savedCount}</td><td>{g.rejectedCount}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
