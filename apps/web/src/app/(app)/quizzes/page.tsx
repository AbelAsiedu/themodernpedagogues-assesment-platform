"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MAX_QUIZ_QUESTIONS, QUESTION_TYPE_LABEL, type QuestionType } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Question } from "@/lib/questions";
import { hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead, Pill } from "@/components/ui";
import { SchoolPicker, useSchoolChoice } from "@/components/school-picker";

interface Quiz { id: string; title: string; timePerQuestionSec: number; questionCount: number; showLeaderboard: boolean; archivedAt: string | null; createdAt: string }
interface Sess { id: string; joinCode: string; status: string; participants: number; createdAt: string; settings: { title: string } }
interface Cls { id: string; name: string }

export default function QuizzesPage() {
  const { state } = useSession();
  const { schools, loading, schoolId, choose } = useSchoolChoice("quizzes.manage");
  if (state.status !== "ready") return null;
  if (loading) return <Loading />;
  if (!schools.length) return (<><PageHead title="Quizzes" /><Empty title="Not available for your account">Teachers and school administrators can build and host quizzes.</Empty></>);
  return (
    <>
      <PageHead title="Quizzes">Build a quiz from approved questions, then open it for your students with a join code.</PageHead>
      <SchoolPicker schools={schools} value={schoolId} onChange={choose} />
      {schoolId && <Quizzes key={schoolId} schoolId={schoolId} />}
    </>
  );
}

function Quizzes({ schoolId }: { schoolId: string }) {
  const { state } = useSession();
  const router = useRouter();
  const quizzes = useApi<{ quizzes: Quiz[] }>(`/institutions/${schoolId}/quizzes`);
  const sessions = useApi<{ sessions: Sess[] }>(`/institutions/${schoolId}/sessions`);
  const classes = useApi<{ classes: Cls[] }>(`/institutions/${schoolId}/classes`);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hostFor, setHostFor] = useState<string | null>(null);
  if (state.status !== "ready") return null;
  const canHost = hasPerm(state.me, "sessions.host", schoolId);

  async function open(quizId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const mode = String(f.get("mode"));
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ session: { id: string } }>(`/quizzes/${quizId}/sessions`, {
        method: "POST",
        body: {
          classId: f.get("classId") || null,
          startNow: mode === "homework",
          durationMinutes: mode === "homework" ? Math.round(Number(f.get("hours")) * 60) : null,
        },
      });
      router.push(`/host/${r.session.id}`);
    } catch (err) { setMsg({ kind: "error", text: describeError(err) }); setBusy(false); }
  }

  return (
    <>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="section" aria-labelledby="open-h">
        <h2 id="open-h">Open sessions and recent games</h2>
        {sessions.loading ? <Loading /> : sessions.error ? <ErrorNote error={sessions.error} retry={sessions.reload} /> : !sessions.data?.sessions.length ? (
          <Empty title="No sessions yet">Choose a quiz below and press "Open for students".</Empty>
        ) : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Sessions</caption>
            <thead><tr><th scope="col">Quiz</th><th scope="col">Code</th><th scope="col">State</th><th scope="col">Students</th><th scope="col">Created</th></tr></thead>
            <tbody>{sessions.data.sessions.map((s) => (
              <tr key={s.id}>
                <td><Link className="rowlink" href={`/host/${s.id}`}>{s.settings.title}</Link></td>
                <td><code>{s.status === "ended" ? "—" : s.joinCode}</code></td>
                <td><Pill value={s.status === "active" ? "active" : s.status === "lobby" ? "pending" : "planned"} /> {s.status}</td>
                <td>{s.participants}</td><td>{fmtDateTime(s.createdAt)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="section" aria-labelledby="q-h">
        <div className="section-head">
          <h2 id="q-h">Your quizzes</h2>
          <button className="btn" onClick={() => setBuilding(!building)}>{building ? "Close builder" : "Build a quiz"}</button>
        </div>
        {building && <Builder schoolId={schoolId} onDone={() => { setBuilding(false); setMsg({ kind: "good", text: "Quiz saved." }); void quizzes.reload(); }} />}
        {quizzes.loading ? <Loading /> : quizzes.error ? <ErrorNote error={quizzes.error} retry={quizzes.reload} /> : !quizzes.data?.quizzes.filter((q) => !q.archivedAt).length ? (
          <Empty title="No quizzes yet">Approve some questions in the Question bank, then build your first quiz.</Empty>
        ) : (
          <div className="stack">
            {quizzes.data.quizzes.filter((q) => !q.archivedAt).map((q) => (
              <div className="qcard" key={q.id}>
                <div className="qcard-head">
                  <strong>{q.title}</strong>
                  <span className="hint">{q.questionCount} questions · {q.timePerQuestionSec}s each · leaderboard {q.showLeaderboard ? "shown" : "hidden"}</span>
                </div>
                {canHost && hostFor !== q.id && <div className="btn-row"><button className="btn" onClick={() => setHostFor(q.id)}>Open for students</button></div>}
                {canHost && hostFor === q.id && (
                  <form className="form" onSubmit={(e) => void open(q.id, e)}>
                    <fieldset className="field">
                      <legend>How will students take it?</legend>
                      <label className="inline"><input type="radio" name="mode" value="live" defaultChecked /> Live in class (I press Start)</label>
                      <label className="inline"><input type="radio" name="mode" value="homework" /> Homework (opens now, closes by itself)</label>
                    </fieldset>
                    <div className="field" style={{ maxWidth: "12rem" }}><label htmlFor={`h-${q.id}`}>Homework closes after (hours)</label><input id={`h-${q.id}`} name="hours" type="number" min="0.5" step="0.5" defaultValue={24} /></div>
                    <div className="field"><label htmlFor={`c-${q.id}`}>Who can join</label>
                      <select id={`c-${q.id}`} name="classId" defaultValue="">
                        <option value="">Every student in the school</option>
                        {classes.data?.classes.filter((c) => c).map((c) => <option key={c.id} value={c.id}>Only {c.name}</option>)}
                      </select></div>
                    <div className="btn-row"><button className="btn" type="submit" disabled={busy}>Create join code</button><button type="button" className="btn quiet" onClick={() => setHostFor(null)}>Cancel</button></div>
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

function Builder({ schoolId, onDone }: { schoolId: string; onDone(): void }) {
  const bank = useApi<{ questions: Question[]; total: number }>(`/institutions/${schoolId}/questions?status=approved&limit=100`);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usable = (bank.data?.questions ?? []).filter((q) => q.type !== "essay");
  const shown = usable.filter((q) => q.stem.toLowerCase().includes(filter.toLowerCase()));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/institutions/${schoolId}/quizzes`, {
        method: "POST",
        body: {
          title: f.get("title"), timePerQuestionSec: Number(f.get("time")), questionIds: picked,
          shuffleQuestions: f.get("shuffleQ") === "on", shuffleOptions: f.get("shuffleO") === "on", showLeaderboard: f.get("board") === "on",
        },
      });
      onDone();
    } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  }

  return (
    <form className="form wide" onSubmit={save}>
      <h3>Build a quiz</h3>
      <Field id="b-title" name="title" label="Title" required minLength={2} maxLength={160} placeholder="Peace building: quick check" />
      <div className="field" style={{ maxWidth: "14rem" }}><label htmlFor="b-time">Seconds per question</label><input id="b-time" name="time" type="number" min={5} max={300} defaultValue={30} required /></div>
      <fieldset className="field">
        <legend>Options</legend>
        <label className="inline"><input type="checkbox" name="shuffleQ" defaultChecked /> Shuffle question order for each student</label>
        <label className="inline"><input type="checkbox" name="shuffleO" defaultChecked /> Shuffle answer options</label>
        <label className="inline"><input type="checkbox" name="board" defaultChecked /> Show the leaderboard to students</label>
      </fieldset>
      <div className="field">
        <label htmlFor="b-filter">Choose questions <span className="hint">({picked.length} of up to {MAX_QUIZ_QUESTIONS} chosen · approved questions only)</span></label>
        <input id="b-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search the question bank" />
      </div>
      {bank.loading ? <Loading /> : bank.error ? <ErrorNote error={bank.error} retry={bank.reload} /> : !usable.length ? (
        <Empty title="No approved questions yet">Approve questions in the Question bank first. Essay questions can't be used in live quizzes.</Empty>
      ) : (
        <div className="check-list" role="group" aria-label="Approved questions">
          {shown.map((q) => (
            <label key={q.id}>
              <input type="checkbox" checked={picked.includes(q.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, q.id] : picked.filter((x) => x !== q.id))} />
              <span>{q.stem} <span className="hint">· {QUESTION_TYPE_LABEL[q.type as QuestionType]}</span></span>
            </label>
          ))}
        </div>
      )}
      {error && <div className="note error" role="alert"><p>{error}</p></div>}
      <div className="btn-row"><button className="btn" type="submit" disabled={busy || !picked.length}>{busy ? "Saving…" : "Save quiz"}</button></div>
    </form>
  );
}
