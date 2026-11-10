"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MAX_EXAM_SECTIONS, QUESTION_TYPE_LABEL, type QuestionType } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Question } from "@/lib/questions";
import { hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead, Tag } from "@/components/ui";
import { SchoolPicker, useSchoolChoice } from "@/components/school-picker";

interface Exam { id: string; title: string; durationMinutes: number; questionCount: number; sittings: number; provenance: string; archivedAt: string | null }
interface Sitting { id: string; title: string; opensAt: string; closesAt: string; status: string; started: number; submitted: number }
interface Cls { id: string; name: string }

export default function ExamsPage() {
  const { state } = useSession();
  const { schools, loading, schoolId, choose } = useSchoolChoice("exams.manage");
  if (state.status !== "ready") return null;
  if (loading) return <Loading />;
  if (!schools.length) return (<><PageHead title="Exams" /><Empty title="Not available for your account">Teachers and school administrators can build and schedule exams.</Empty></>);
  return (
    <>
      <PageHead title="Exams">Build a timed exam with sections from your approved questions, then schedule it. The server runs the clock and submits automatically when time is up.</PageHead>
      <SchoolPicker schools={schools} value={schoolId} onChange={choose} />
      {schoolId && <Exams key={schoolId} schoolId={schoolId} />}
    </>
  );
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Exams({ schoolId }: { schoolId: string }) {
  const { state } = useSession();
  const exams = useApi<{ exams: Exam[] }>(`/institutions/${schoolId}/exams`);
  const sittings = useApi<{ sittings: Sitting[] }>(`/institutions/${schoolId}/sittings`);
  const classes = useApi<{ classes: Cls[] }>(`/institutions/${schoolId}/classes`);
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== "ready") return null;
  if (!hasPerm(state.me, "exams.manage", schoolId)) return null;

  async function schedule(examId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ sitting: { id: string } }>(`/exams/${examId}/sittings`, {
        method: "POST",
        body: { classId: f.get("classId") || null, opensAt: new Date(String(f.get("opens"))).toISOString(), closesAt: new Date(String(f.get("closes"))).toISOString() },
      });
      router.push(`/sittings/${r.sitting.id}`);
    } catch (err) { setMsg({ kind: "error", text: describeError(err) }); setBusy(false); }
  }

  const now = new Date();
  return (
    <>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="section" aria-labelledby="sit-h">
        <h2 id="sit-h">Scheduled exams</h2>
        {sittings.loading ? <Loading /> : sittings.error ? <ErrorNote error={sittings.error} retry={sittings.reload} /> : !sittings.data?.sittings.length ? (
          <Empty title="Nothing scheduled">Choose an exam below and press "Schedule".</Empty>
        ) : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Scheduled exams</caption>
            <thead><tr><th scope="col">Exam</th><th scope="col">Opens</th><th scope="col">Closes</th><th scope="col">State</th><th scope="col">Started</th><th scope="col">Submitted</th></tr></thead>
            <tbody>{sittings.data.sittings.map((s) => {
              const phase = s.status === "cancelled" ? "cancelled" : now < new Date(s.opensAt) ? "upcoming" : now >= new Date(s.closesAt) ? "closed" : "open";
              return (
                <tr key={s.id}>
                  <td><Link className="rowlink" href={`/sittings/${s.id}`}>{s.title}</Link></td>
                  <td>{fmtDateTime(s.opensAt)}</td><td>{fmtDateTime(s.closesAt)}</td>
                  <td><Tag tone={phase === "open" ? "ok" : phase === "upcoming" ? "wait" : "plain"}>{phase}</Tag></td>
                  <td>{s.started}</td><td>{s.submitted}</td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" aria-labelledby="ex-h">
        <div className="section-head">
          <h2 id="ex-h">Your exams</h2>
          <button className="btn" onClick={() => setBuilding(!building)}>{building ? "Close builder" : "Build an exam"}</button>
        </div>
        {building && <Builder schoolId={schoolId} onDone={() => { setBuilding(false); setMsg({ kind: "good", text: "Exam saved. You can schedule it now." }); void exams.reload(); }} />}
        {exams.loading ? <Loading /> : exams.error ? <ErrorNote error={exams.error} retry={exams.reload} /> : !exams.data?.exams.filter((x) => !x.archivedAt).length ? (
          <Empty title="No exams yet">Approve questions in the Question bank, then build your first exam.</Empty>
        ) : (
          <div className="stack">
            {exams.data.exams.filter((x) => !x.archivedAt).map((x) => (
              <div className="qcard" key={x.id}>
                <div className="qcard-head">
                  <strong>{x.title}</strong>
                  <span className="hint">{x.questionCount} questions · {x.durationMinutes} min · {x.provenance.replace("_", " ")} · scheduled {x.sittings}×</span>
                </div>
                {scheduling !== x.id ? <div className="btn-row"><button className="btn" onClick={() => setScheduling(x.id)}>Schedule</button></div> : (
                  <form className="form" onSubmit={(e) => void schedule(x.id, e)}>
                    <div className="field"><label htmlFor={`o-${x.id}`}>Opens</label><input id={`o-${x.id}`} name="opens" type="datetime-local" required defaultValue={localInput(new Date())} /></div>
                    <div className="field"><label htmlFor={`c-${x.id}`}>Closes</label><input id={`c-${x.id}`} name="closes" type="datetime-local" required defaultValue={localInput(new Date(Date.now() + 24 * 3600_000))} />
                      <span className="hint">Must leave at least {x.durationMinutes} minutes. Each student's own clock starts when they press Start, and never runs past this time.</span></div>
                    <div className="field"><label htmlFor={`k-${x.id}`}>Who can sit it</label>
                      <select id={`k-${x.id}`} name="classId" defaultValue="">
                        <option value="">Every student in the school</option>
                        {classes.data?.classes.map((c) => <option key={c.id} value={c.id}>Only {c.name}</option>)}
                      </select></div>
                    <div className="btn-row"><button className="btn" type="submit" disabled={busy}>Schedule exam</button><button type="button" className="btn quiet" onClick={() => setScheduling(null)}>Cancel</button></div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

interface Sec { title: string; rule: "all" | "any"; count: number; ids: string[] }

function Builder({ schoolId, onDone }: { schoolId: string; onDone(): void }) {
  const bank = useApi<{ questions: Question[] }>(`/institutions/${schoolId}/questions?status=approved&limit=100`);
  const [secs, setSecs] = useState<Sec[]>([{ title: "Section A", rule: "all", count: 1, ids: [] }]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = bank.data?.questions ?? [];
  const used = new Set(secs.flatMap((s) => s.ids));
  const update = (i: number, patch: Partial<Sec>) => setSecs(secs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const shown = qs.filter((q) => q.stem.toLowerCase().includes(filter.toLowerCase()));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/institutions/${schoolId}/exams`, {
        method: "POST",
        body: {
          title: f.get("title"), instructions: String(f.get("instructions") ?? "").trim() || null, durationMinutes: Number(f.get("minutes")),
          shuffleOptions: f.get("shuffleO") === "on", provenance: "teacher_created",
          sections: secs.map((s) => ({ title: s.title, rule: s.rule === "all" ? { type: "answer_all" } : { type: "answer_any", count: s.count }, questionIds: s.ids })),
        },
      });
      onDone();
    } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }

  return (
    <form className="form wide" onSubmit={save}>
      <h3>Build an exam</h3>
      <Field id="e-title" name="title" label="Title" required minLength={2} maxLength={160} placeholder="Term 1 Social Studies test" />
      <div className="field"><label htmlFor="e-ins">Instructions for students <span className="hint">(optional)</span></label><textarea id="e-ins" name="instructions" rows={3} maxLength={2000} /></div>
      <div className="field" style={{ maxWidth: "14rem" }}><label htmlFor="e-min">Duration (minutes)</label><input id="e-min" name="minutes" type="number" min={5} max={360} defaultValue={60} required /></div>
      <label className="inline"><input type="checkbox" name="shuffleO" defaultChecked /> Shuffle answer options for each student</label>
      <p className="hint">Results stay hidden from students until you release them after the exam closes. Essays are saved and wait for a person to mark them.</p>

      <div className="field"><label htmlFor="e-filter">Search the question bank</label><input id="e-filter" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {bank.loading ? <Loading /> : bank.error ? <ErrorNote error={bank.error} retry={bank.reload} /> : !qs.length ? (
        <Empty title="No approved questions yet">Approve questions in the Question bank first.</Empty>
      ) : secs.map((s, i) => (
        <fieldset className="field exam-section-edit" key={i}>
          <legend>Section {i + 1}</legend>
          <div className="field"><label htmlFor={`st-${i}`}>Section title</label><input id={`st-${i}`} value={s.title} maxLength={80} required onChange={(e) => update(i, { title: e.target.value })} /></div>
          <div className="btn-row" style={{ alignItems: "end" }}>
            <div className="field"><label htmlFor={`sr-${i}`}>Candidates</label>
              <select id={`sr-${i}`} value={s.rule} onChange={(e) => update(i, { rule: e.target.value as "all" | "any" })}><option value="all">answer all questions</option><option value="any">answer any…</option></select></div>
            {s.rule === "any" && <div className="field" style={{ maxWidth: "7rem" }}><label htmlFor={`sc-${i}`}>How many</label><input id={`sc-${i}`} type="number" min={1} max={Math.max(1, s.ids.length)} value={s.count} onChange={(e) => update(i, { count: Number(e.target.value) })} /></div>}
          </div>
          {s.rule === "any" && <p className="hint">Every question in an "answer any" section must carry the same marks.</p>}
          <div className="check-list" role="group" aria-label={`Questions for ${s.title}`}>
            {shown.map((q) => {
              const here = s.ids.includes(q.id);
              return (
                <label key={q.id} className={!here && used.has(q.id) ? "taken" : ""}>
                  <input type="checkbox" checked={here} disabled={!here && used.has(q.id)} onChange={(e) => update(i, { ids: e.target.checked ? [...s.ids, q.id] : s.ids.filter((x) => x !== q.id) })} />
                  <span>{q.stem} <span className="hint">· {QUESTION_TYPE_LABEL[q.type as QuestionType]} · {q.marks} mark{q.marks === 1 ? "" : "s"}</span></span>
                </label>
              );
            })}
          </div>
          <p className="hint">{s.ids.length} chosen</p>
          {secs.length > 1 && <button type="button" className="btn small danger" onClick={() => setSecs(secs.filter((_, j) => j !== i))}>Remove this section</button>}
        </fieldset>
      ))}
      {secs.length < MAX_EXAM_SECTIONS && <div className="btn-row"><button type="button" className="btn quiet" onClick={() => setSecs([...secs, { title: `Section ${String.fromCharCode(65 + secs.length)}`, rule: "all", count: 1, ids: [] }])}>Add a section</button></div>}
      {error && <div className="note error" role="alert"><p>{error}</p></div>}
      <div className="btn-row"><button className="btn" type="submit" disabled={busy || secs.some((s) => !s.ids.length)}>{busy ? "Saving…" : "Save exam"}</button></div>
    </form>
  );
}
