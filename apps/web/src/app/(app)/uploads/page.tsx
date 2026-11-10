"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { DIFFICULTIES, MAX_UPLOAD_BYTES, QUESTION_TYPE_LABEL, UPLOAD_ACCEPT, UPLOAD_KIND_LABEL, type QuestionType, } from "@tmp/shared";
import { api, apiUpload, describeError, useApi } from "@/lib/api";
import type { Subject } from "@/lib/questions";
import { Empty, ErrorNote, Loading, PageHead } from "@/components/ui";
import { SchoolPicker, useSchoolChoice } from "@/components/school-picker";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import type { ParsedItem, UploadSummary } from "@/lib/uploads";
import { hasPerm, useSession } from "@/lib/session";

export default function UploadsPage() {
  const { state } = useSession();
  const { schools, loading, schoolId, choose } = useSchoolChoice("questions.write");
  if (state.status !== "ready") return null;
  if (loading) return <Loading />;
  if (!schools.length) return (
    <>
      <PageHead title="Import files" />
      <Empty title="Not available for your account">Teachers and school administrators can import files.</Empty>
    </>
  );
  return (
    <>
      <PageHead title="Import files">
        Bring in your own Excel, CSV, Word, PowerPoint, PDF, text or picture files. Ready-made questions are imported exactly as written. Other material can be turned into draft questions by AI.
      </PageHead>
      <SchoolPicker schools={schools} value={schoolId} onChange={choose} />
      {schoolId && <Files key={schoolId} schoolId={schoolId} />}
    </>
  );
}

function Files({ schoolId }: { schoolId: string }) {
  const caps = useApi<{ maxBytes: number; ocr: boolean }>(`/institutions/${schoolId}/uploads/capabilities`);
  const list = useApi<{ uploads: UploadSummary[] }>(`/institutions/${schoolId}/uploads`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) { setMsg({ kind: "error", text: "Choose a file first." }); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setMsg({ kind: "error", text: `That file is ${fmtBytes(file.size)}. The limit is ${fmtBytes(MAX_UPLOAD_BYTES)}. Split it into smaller files.` }); return; }
    // The server also checks this; the box makes the person say it on purpose.
    f.set("confirmRights", f.get("confirmRights") ? "true" : "false");
    setBusy(true); setMsg(null);
    try {
      const r = await apiUpload<{ upload: UploadSummary; reused: boolean }>(`/institutions/${schoolId}/uploads`, f);
      setMsg({ kind: "good", text: r.reused ? "You had already uploaded this exact file, so it's opened below." : "File read. Check what was found below." });
      setOpenId(r.upload.id);
      form.reset();
      await list.reload();
    } catch (err) { setMsg({ kind: "error", text: describeError(err) }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <section className="section" aria-labelledby="up-h">
        <h2 id="up-h">Upload a file</h2>
        <form className="form wide" onSubmit={(e) => void send(e)}>
          <div className="dropzone">
            <div className="field">
              <label htmlFor="u-file">File <span className="hint">(up to {fmtBytes(MAX_UPLOAD_BYTES)})</span></label>
              <input id="u-file" name="file" type="file" accept={UPLOAD_ACCEPT} required aria-describedby="u-types" />
              <span className="hint" id="u-types">Excel (.xlsx), CSV, Word (.docx), PowerPoint (.pptx), PDF, text or Markdown, and PNG/JPG pictures. Older .doc, .xls and .ppt files can't be read: open them and Save As the newer type.</span>
            </div>
            <label className="check-line"><input type="checkbox" name="confirmRights" required /> I wrote this material, or I have permission to use it.</label>
          </div>
          {caps.data && (
            <p className="hint">
              Reading text from pictures and scanned PDFs (OCR): <strong>{caps.data.ocr ? "available on this server" : "not available on this server"}</strong>.
              {caps.data.ocr ? " Text read this way can contain mistakes, so always check it." : " Use a Word, Excel or text-based PDF file instead."}
            </p>
          )}
          <div className="btn-row"><button className="btn" type="submit" disabled={busy}>{busy ? "Reading the file… scans can take a minute" : "Upload and read"}</button></div>
        </form>
        {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}
      </section>

      <section className="section" aria-labelledby="fl-h">
        <h2 id="fl-h">Your files</h2>
        {list.loading && !list.data ? <Loading /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data?.uploads.length ? (
          <Empty title="No files yet">Upload a quiz spreadsheet or your lesson notes to get started.</Empty>
        ) : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Uploaded files</caption>
            <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Found</th><th scope="col">Uploaded</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{list.data.uploads.map((u) => (
              <tr key={u.id}>
                <td className="stem-cell">{u.filename} <span className="hint">({fmtBytes(u.sizeBytes)})</span></td>
                <td>{UPLOAD_KIND_LABEL[u.kind]}</td>
                <td>{u.questionTable ? `${u.questionTable.ready} of ${u.questionTable.total} questions ready` : `${u.sections.length} part${u.sections.length === 1 ? "" : "s"} of text`}</td>
                <td>{fmtDateTime(u.createdAt)}</td>
                <td><button className="btn small quiet" aria-expanded={openId === u.id} onClick={() => setOpenId(openId === u.id ? null : u.id)}>{openId === u.id ? "Close" : "Open"}</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      {openId && <Detail key={openId} schoolId={schoolId} id={openId} onGone={() => { setOpenId(null); void list.reload(); }} onChanged={() => void list.reload()} />}
    </>
  );
}

const answerOf = (i: ParsedItem) =>
  i.type === "mcq" ? (i.correctIndex !== null ? i.options[i.correctIndex] : "—")
  : i.type === "true_false" ? (i.correctBool === null ? "—" : i.correctBool ? "True" : "False")
  : i.type === "short_answer" ? i.accepted.join(" · ") : "—";
const typeLabel = (t: string) => (t in QUESTION_TYPE_LABEL ? QUESTION_TYPE_LABEL[t as QuestionType] : "Not supported");

function Detail({ schoolId, id, onGone, onChanged }: { schoolId: string; id: string; onGone(): void; onChanged(): void }) {
  const { state } = useSession();
  const me = state.status === "ready" ? state.me : null;
  const subjects = useApi<{ subjects: Subject[] }>(`/institutions/${schoolId}/subjects`);
  const [subjectId, setSubjectId] = useState("");
  const subs = subjects.data?.subjects ?? [];
  const chosen = subs.find((s) => s.id === (subjectId || subs[0]?.id));
  // Passing the subject lets the server flag questions that are already in the bank.
  const detail = useApi<{ upload: UploadSummary }>(`/uploads/${id}${chosen ? `?subjectId=${chosen.id}` : ""}`);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [approve, setApprove] = useState(false);
  const [makeQuiz, setMakeQuiz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; status: string; skipped: { row: number; stem: string; reason: string }[]; quiz: { id: string; title: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!me) return null;
  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) return <ErrorNote error={detail.error} retry={detail.reload} />;
  const u = detail.data?.upload;
  if (!u) return null;
  const canReview = hasPerm(me, "questions.review", schoolId);
  const canQuiz = hasPerm(me, "quizzes.manage", schoolId);
  const canAi = hasPerm(me, "ai.generate", schoolId);
  const items = u.questionTable?.items ?? [];
  const importable = (i: ParsedItem) => !i.problems.length && !i.duplicate;
  const picked = items.filter((i) => importable(i) && !off.has(i.row));
  const toggle = (row: number) => setOff((s) => { const n = new Set(s); if (n.has(row)) n.delete(row); else n.add(row); return n; });

  async function doImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null); setResult(null);
    try {
      const quizTime = String(f.get("quizTime") ?? "").trim();
      const r = await api<NonNullable<typeof result>>(`/uploads/${id}/import-questions`, {
        method: "POST",
        body: {
          subjectId: chosen?.id, topicId: f.get("topicId") || null, difficulty: f.get("difficulty"), rows: picked.map((i) => i.row), approve,
          ...(makeQuiz ? { quiz: {
            title: String(f.get("quizTitle") ?? "").trim(), ...(quizTime ? { timePerQuestionSec: Number(quizTime) } : {}),
            shuffleQuestions: !!f.get("shuffleQ"), shuffleOptions: !!f.get("shuffleO"), showLeaderboard: !!f.get("board"),
          } } : {}),
        },
      });
      setResult(r);
      await detail.reload(); onChanged();
    } catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  }

  async function remove() {
    try { await api(`/uploads/${id}`, { method: "DELETE" }); onGone(); }
    catch (err) { setError(describeError(err)); setConfirmDelete(false); }
  }

  const t = u.questionTable;
  return (
    <section className="section" aria-labelledby="det-h">
      <h2 id="det-h">{u.filename}</h2>
      <p className="hint">{UPLOAD_KIND_LABEL[u.kind]} · {fmtBytes(u.sizeBytes)} · {u.charCount.toLocaleString("en-GH")} characters of text. The original file isn't kept, only the text and questions found in it.</p>
      {u.warnings.map((w) => <div className="note warn" key={w} role="status"><p>{w}</p></div>)}

      {t && (
        <>
          <h3>Questions found</h3>
          <p>
            <strong>{t.ready}</strong> of {t.total} rows can be imported ({t.layout}).{t.truncated ? " Only the first 500 rows were read." : ""} Nothing is saved until you press Import.
          </p>
          {error && <div className="note error" role="alert"><p>{error}</p></div>}
          {result && (
            <div className="note good" role="status">
              <p><strong>Imported {result.imported} question{result.imported === 1 ? "" : "s"}</strong> {result.status === "approved" ? "and approved them." : "into the review queue. They can't be used in a quiz until a teacher approves them."}</p>
              <p><Link href="/questions?source=import">Open the question bank</Link>{result.quiz && <> · <Link href="/quizzes">Quiz &ldquo;{result.quiz.title}&rdquo; is ready to host</Link></>}</p>
              {result.skipped.length > 0 && (
                <details><summary>{result.skipped.length} skipped</summary>
                  <ul>{result.skipped.map((s) => <li key={s.row}>{s.stem || `Row ${s.row}`}: {s.reason}</li>)}</ul></details>
              )}
            </div>
          )}
          <div className="btn-row" style={{ alignItems: "center" }}>
            <button type="button" className="btn small quiet" onClick={() => setOff(new Set())}>Select all</button>
            <button type="button" className="btn small quiet" onClick={() => setOff(new Set(items.map((i) => i.row)))}>Select none</button>
            <span className="hint" aria-live="polite">{picked.length} selected</span>
          </div>
          <div className="table-wrap"><table className="import-table">
            <caption className="sr-only">Questions found in the file</caption>
            <thead><tr><th scope="col" className="pick"><span className="sr-only">Import</span></th><th scope="col">Question</th><th scope="col">Type</th><th scope="col">Right answer</th></tr></thead>
            <tbody>{items.map((i) => {
              const bad = i.problems.length > 0;
              return (
                <tr key={i.row} className={bad ? "bad" : undefined}>
                  <td className="pick"><input type="checkbox" aria-label={`Import question ${i.row}`} disabled={!importable(i)} checked={importable(i) && !off.has(i.row)} onChange={() => toggle(i.row)} /></td>
                  <td className="stem-cell">
                    {i.stem || <em>(no question text)</em>}
                    {i.options.length > 0 && <details><summary>{i.options.length} options</summary><ol type="A">{i.options.map((o, k) => <li key={k}>{o}</li>)}</ol></details>}
                    {bad && <div className="why">Can't import: {i.problems.join(" ")}</div>}
                    {i.duplicate && !bad && <div className="fine">Already in your question bank for this subject.</div>}
                    {i.notes.map((n) => <div className="fine" key={n}>{n}</div>)}
                  </td>
                  <td>{typeLabel(i.type)}</td>
                  <td>{answerOf(i)}</td>
                </tr>);
            })}</tbody>
          </table></div>

          <form className="form wide" onSubmit={(e) => void doImport(e)} style={{ marginTop: "1rem" }}>
            <h3>Import the selected questions</h3>
            {subjects.loading ? <Loading /> : !subs.length ? (
              <Empty title="Add a subject first">Subjects and topics are set up in the <Link href="/questions">Question bank</Link>.</Empty>
            ) : (
              <>
                <div className="row2">
                  <div className="field"><label htmlFor="i-sub">Subject</label>
                    <select id="i-sub" value={chosen?.id ?? ""} onChange={(e) => setSubjectId(e.target.value)}>
                      {subs.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.level})</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="i-topic">Topic</label>
                    <select id="i-topic" name="topicId" defaultValue="" key={chosen?.id}>
                      <option value="">Any topic</option>{chosen?.topics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select></div>
                </div>
                <div className="field" style={{ maxWidth: "14rem" }}><label htmlFor="i-diff">Difficulty <span className="hint">(for rows that don't say)</span></label>
                  <select id="i-diff" name="difficulty" defaultValue="medium">{DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
                {canReview && (
                  <label className="check-line"><input type="checkbox" checked={approve} onChange={(e) => { setApprove(e.target.checked); if (!e.target.checked) setMakeQuiz(false); }} /> I have checked these questions and answers. Approve them now.</label>
                )}
                {!approve && <p className="hint">Without approval, the questions wait in the review queue until a teacher approves each one.</p>}
                {approve && canQuiz && (
                  <label className="check-line"><input type="checkbox" checked={makeQuiz} onChange={(e) => setMakeQuiz(e.target.checked)} /> Also make a quiz from these questions.</label>
                )}
                {makeQuiz && (
                  <fieldset className="stack" style={{ border: "1px solid var(--rule)", borderRadius: "var(--radius)", padding: "0.8rem" }}>
                    <legend>Quiz settings</legend>
                    <div className="row2">
                      <div className="field"><label htmlFor="q-title">Quiz title</label>
                        <input id="q-title" name="quizTitle" required minLength={2} maxLength={160} defaultValue={u.filename.replace(/\.[^.]+$/, "").slice(0, 160)} /></div>
                      <div className="field"><label htmlFor="q-time">Seconds per question</label>
                        <input id="q-time" name="quizTime" type="number" min={5} max={300} placeholder={t.suggestedTimeSec ? `${t.suggestedTimeSec} (from the file)` : "30"} />
                        <span className="hint">Leave empty to use {t.suggestedTimeSec ? `${t.suggestedTimeSec} seconds, the typical time in your file` : "30 seconds"}.</span></div>
                    </div>
                    <label className="check-line"><input type="checkbox" name="shuffleQ" defaultChecked /> Shuffle the question order</label>
                    <label className="check-line"><input type="checkbox" name="shuffleO" defaultChecked /> Shuffle the options</label>
                    <label className="check-line"><input type="checkbox" name="board" defaultChecked /> Show the live leaderboard</label>
                  </fieldset>
                )}
                <div className="btn-row"><button className="btn" type="submit" disabled={busy || !picked.length}>{busy ? "Importing…" : `Import ${picked.length} question${picked.length === 1 ? "" : "s"}`}</button></div>
              </>
            )}
          </form>
        </>
      )}

      <h3>Text found in the file</h3>
      {!u.sections.length ? <p className="hint">No plain text was found, only the table of questions.</p> : (
        <>
          <ul className="plain-list">
            {u.sections.slice(0, 12).map((s) => <li key={s.id}><strong>{s.label}</strong> <span className="hint">({s.chars.toLocaleString("en-GH")} characters{s.ocr ? ", read from a picture" : ""})</span><br /><span className="hint">{s.preview}{s.chars > 160 ? "…" : ""}</span></li>)}
          </ul>
          {u.sections.length > 12 && <p className="hint">…and {u.sections.length - 12} more parts.</p>}
          {canAi ? <p><Link className="btn small" href={`/studio?upload=${u.id}`}>Write new questions from this text with AI</Link></p> : null}
        </>
      )}

      <div className="btn-row" style={{ alignItems: "center", marginTop: "1rem" }}>
        {!confirmDelete ? <button className="btn small danger" onClick={() => setConfirmDelete(true)}>Delete this file</button> : (
          <>
            <span role="alert"><strong>Delete the file's text? Questions you already imported stay.</strong></span>
            <button className="btn small danger" onClick={() => void remove()}>Yes, delete</button>
            <button className="btn small quiet" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </>
        )}
      </div>
    </section>
  );
}
