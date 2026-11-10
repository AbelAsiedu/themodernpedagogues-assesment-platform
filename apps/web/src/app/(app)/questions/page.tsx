"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { QUESTION_STATUSES, QUESTION_TYPES, QUESTION_TYPE_LABEL } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import { STATUS_LABEL, type Question, type Subject } from "@/lib/questions";
import { hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead } from "@/components/ui";
import { SchoolPicker, useSchoolChoice } from "@/components/school-picker";
import { QuestionEditor } from "@/components/question-editor";
import { StatusPill } from "@/components/question-view";

export default function QuestionBankPage() {
  const { state } = useSession();
  const { schools, loading: loadingSchools, schoolId, choose } = useSchoolChoice("questions.read");
  if (state.status !== "ready") return null;
  if (loadingSchools) return <Loading />;
  if (!schools.length) return (
    <>
      <PageHead title="Question bank" />
      <Empty title="No school to show">Your account isn't linked to a school with access to the question bank.</Empty>
    </>
  );
  return (
    <>
      <PageHead title="Question bank">Questions belong to your school. Only approved questions can be used in quizzes and exams.</PageHead>
      <SchoolPicker schools={schools} value={schoolId} onChange={choose} />
      {schoolId && <Bank key={schoolId} schoolId={schoolId} />}
    </>
  );
}

function Bank({ schoolId }: { schoolId: string }) {
  const { state } = useSession();
  const me = state.status === "ready" ? state.me : null;
  const [filters, setFilters] = useState({ subjectId: "", status: "", type: "", source: "", q: "" });
  const [page, setPage] = useState(0);
  const [writing, setWriting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const LIMIT = 20;

  const subjects = useApi<{ subjects: Subject[] }>(`/institutions/${schoolId}/subjects`);
  const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT) });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  const list = useApi<{ questions: Question[]; total: number }>(`/institutions/${schoolId}/questions?${qs}`);

  if (!me) return null;
  const canWrite = hasPerm(me, "questions.write", schoolId);
  const canSubjects = hasPerm(me, "subjects.manage", schoolId);
  const subjectName = (id: string) => subjects.data?.subjects.find((s) => s.id === id)?.name ?? "—";
  const set = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setPage(0); };

  async function addSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setMsg(null);
    try {
      await api(`/institutions/${schoolId}/subjects`, { method: "POST", body: { name: f.get("name"), level: f.get("level") } });
      form.reset();
      setMsg({ kind: "good", text: `Added ${f.get("name")}.` });
      await subjects.reload();
    } catch (err) { setMsg({ kind: "error", text: describeError(err) }); }
  }
  async function addTopic(subjectId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "");
    setMsg(null);
    try {
      await api(`/subjects/${subjectId}/topics`, { method: "POST", body: { name } });
      form.reset();
      setMsg({ kind: "good", text: `Added topic ${name}.` });
      await subjects.reload();
    } catch (err) { setMsg({ kind: "error", text: describeError(err) }); }
  }

  const total = list.data?.total ?? 0;
  return (
    <>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="section" aria-labelledby="qb-h">
        <div className="section-head">
          <h2 id="qb-h">Questions {list.data && <span className="hint">({total})</span>}</h2>
          {canWrite && subjects.data?.subjects.length ? <button className="btn" onClick={() => setWriting(!writing)}>{writing ? "Close editor" : "Write a question"}</button> : null}
        </div>
        {writing && subjects.data && (
          <QuestionEditor schoolId={schoolId} subjects={subjects.data.subjects} onCancel={() => setWriting(false)}
            onSaved={(q) => { setWriting(false); setMsg({ kind: "good", text: "Saved as a draft. Open it to submit for review." }); void list.reload(); void q; }} />
        )}

        <div className="toolbar" role="search" aria-label="Filter questions">
          <div className="field"><label htmlFor="f-q">Search</label><input id="f-q" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Words in the question" /></div>
          <div className="field"><label htmlFor="f-s">Subject</label>
            <select id="f-s" value={filters.subjectId} onChange={(e) => set({ subjectId: e.target.value })}>
              <option value="">All</option>{subjects.data?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.level})</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-st">Status</label>
            <select id="f-st" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All</option>{QUESTION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-t">Type</label>
            <select id="f-t" value={filters.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">All</option>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
            </select></div>
          <div className="field"><label htmlFor="f-src">Source</label>
            <select id="f-src" value={filters.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">All</option><option value="manual">Written</option><option value="ai">AI draft</option><option value="import">Imported</option>
            </select></div>
        </div>

        {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data?.questions.length ? (
          <Empty title="No questions found">
            {subjects.data?.subjects.length ? (canWrite ? "Write one yourself, import a file, or generate drafts in the AI Studio." : "Nothing matches these filters.") : "Add a subject below first, then you can write questions."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Questions</caption>
                <thead><tr><th scope="col">Question</th><th scope="col">Subject</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {list.data.questions.map((q) => (
                    <tr key={q.id}>
                      <td className="stem-cell"><Link className="rowlink" href={`/questions/${q.id}`}>{q.stem.length > 110 ? q.stem.slice(0, 110) + "…" : q.stem}</Link></td>
                      <td>{subjectName(q.subjectId)}</td>
                      <td>{QUESTION_TYPE_LABEL[q.type]}</td>
                      <td><StatusPill status={q.status} /></td>
                      <td>{q.source === "ai" ? "AI draft" : q.source === "import" ? "Imported" : "Written"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ alignItems: "center" }}>
              <button className="btn small quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="hint">Showing {page * LIMIT + 1}–{Math.min(total, (page + 1) * LIMIT)} of {total}</span>
              <button className="btn small quiet" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </>
        )}
      </section>

      <section className="section" aria-labelledby="sub-h">
        <h2 id="sub-h">Subjects and topics</h2>
        {subjects.loading ? <Loading /> : subjects.error ? <ErrorNote error={subjects.error} retry={subjects.reload} /> : !subjects.data?.subjects.length ? (
          <Empty title="No subjects yet">{canSubjects ? "Add your first subject below." : "A teacher or school administrator needs to add subjects."}</Empty>
        ) : (
          <div className="stack">
            {subjects.data.subjects.map((s) => (
              <div className="qcard" key={s.id}>
                <div className="qcard-head"><strong>{s.name}</strong><span className="hint">{s.level}</span></div>
                <p>{s.topics.length ? s.topics.map((t) => t.name).join(" · ") : <span className="hint">No topics yet</span>}</p>
                {canSubjects && (
                  <form className="toolbar" onSubmit={(e) => void addTopic(s.id, e)}>
                    <Field id={`t-${s.id}`} name="name" label="New topic" required maxLength={120} />
                    <button className="btn small" type="submit">Add topic</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
        {canSubjects && (
          <form className="form" onSubmit={(e) => void addSubject(e)}>
            <h3>Add a subject</h3>
            <Field id="s-name" name="name" label="Subject name" required placeholder="Social Studies" />
            <Field id="s-level" name="level" label="Level" required placeholder="JHS 3" />
            <div className="btn-row"><button className="btn" type="submit">Add subject</button></div>
          </form>
        )}
      </section>
    </>
  );
}
