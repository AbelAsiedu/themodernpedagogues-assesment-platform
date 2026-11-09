"use client";
import { useState, type FormEvent } from "react";
import { DIFFICULTIES, QUESTION_TYPES, QUESTION_TYPE_LABEL, type QuestionType } from "@tmp/shared";
import { api, describeError } from "@/lib/api";
import type { McqContent, Question, Subject } from "@/lib/questions";

const LETTERS = ["A", "B", "C", "D"];

interface Props {
  schoolId: string;
  subjects: Subject[];
  initial?: Question;
  onSaved(q: Question): void;
  onCancel?(): void;
}

/** Create or edit a question. All rules are re-checked by the API; this form only guides the person writing it. */
export function QuestionEditor({ schoolId, subjects, initial, onSaved, onCancel }: Props) {
  const editing = !!initial;
  const c = (initial?.content ?? {}) as Record<string, unknown>;
  const [type, setType] = useState<QuestionType>(initial?.type ?? "mcq");
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? subjects[0]?.id ?? "");
  const [topicId, setTopicId] = useState(initial?.topicId ?? "");
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "medium");
  const [marks, setMarks] = useState(String(initial?.marks ?? 1));
  const mcq = c as unknown as Partial<McqContent>;
  const [opts, setOpts] = useState<string[]>(LETTERS.map((l) => mcq.options?.find((o) => o.id === l)?.text ?? ""));
  const [correct, setCorrect] = useState<string>(mcq.correctOptionId ?? "A");
  const [tf, setTf] = useState<boolean>((c as { correct?: boolean }).correct ?? true);
  const [answers, setAnswers] = useState<string>(((c as { acceptedAnswers?: string[] }).acceptedAnswers ?? []).join("\n"));
  const [rubric, setRubric] = useState<{ point: string; marks: string }[]>(
    ((c as { rubric?: { point: string; marks: number }[] }).rubric ?? [{ point: "", marks: 1 }]).map((r) => ({ point: r.point, marks: String(r.marks) })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subject = subjects.find((s) => s.id === subjectId);
  const rubricTotal = rubric.reduce((a, r) => a + (Number(r.marks) || 0), 0);

  function content() {
    switch (type) {
      case "mcq": {
        const options = opts.map((text, i) => ({ id: LETTERS[i]!, text: text.trim() })).filter((o) => o.text);
        return { options, correctOptionId: correct };
      }
      case "true_false": return { correct: tf };
      case "short_answer": return { acceptedAnswers: answers.split("\n").map((a) => a.trim()).filter(Boolean) };
      case "essay": return { rubric: rubric.filter((r) => r.point.trim()).map((r) => ({ point: r.point.trim(), marks: Number(r.marks) || 0 })) };
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const common = {
      stem, explanation: explanation.trim() || null, difficulty,
      marks: type === "essay" ? rubricTotal : Number(marks),
      topicId: topicId || null,
    };
    try {
      const res = editing
        ? await api<{ question: Question }>(`/questions/${initial!.id}`, { method: "PATCH", body: { ...common, content: content() } })
        : await api<{ question: Question }>(`/institutions/${schoolId}/questions`, { method: "POST", body: { ...common, type, subjectId, content: content() } });
      onSaved(res.question);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form wide" onSubmit={submit}>
      <h3>{editing ? "Edit question" : "Write a question"}</h3>
      {editing && initial!.status !== "draft" && (
        <div className="note" style={{ background: "var(--wait-wash)", borderColor: "#e7cf9b" }} role="status">
          <p>Saving changes sends this question back for review, so nothing already approved is altered silently.</p>
        </div>
      )}
      {!editing && (
        <div className="row2">
          <div className="field">
            <label htmlFor="q-type">Type</label>
            <select id="q-type" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="q-subject">Subject</label>
            <select id="q-subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTopicId(""); }} required>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.level})</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="q-topic">Topic <span className="hint">(optional)</span></label>
          <select id="q-topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">No topic</option>
            {(subject?.topics ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="q-diff">Difficulty</label>
          <select id="q-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="q-stem">Question</label>
        <textarea id="q-stem" value={stem} onChange={(e) => setStem(e.target.value)} required maxLength={2000} rows={3} />
      </div>

      {type === "mcq" && (
        <fieldset className="field">
          <legend>Options — choose the correct one</legend>
          {LETTERS.map((l, i) => (
            <div className="optrow" key={l}>
              <input type="radio" name="correct" id={`correct-${l}`} checked={correct === l} onChange={() => setCorrect(l)} aria-label={`Option ${l} is correct`} />
              <label htmlFor={`opt-${l}`} className="optlabel">{l}.</label>
              <input id={`opt-${l}`} value={opts[i]} onChange={(e) => setOpts(opts.map((o, j) => (j === i ? e.target.value : o)))} maxLength={500} required={i < 2} />
            </div>
          ))}
          <span className="hint">Fill at least two. Leave unused options empty.</span>
        </fieldset>
      )}
      {type === "true_false" && (
        <fieldset className="field">
          <legend>The statement is</legend>
          <label className="inline"><input type="radio" name="tf" checked={tf} onChange={() => setTf(true)} /> True</label>
          <label className="inline"><input type="radio" name="tf" checked={!tf} onChange={() => setTf(false)} /> False</label>
        </fieldset>
      )}
      {type === "short_answer" && (
        <div className="field">
          <label htmlFor="q-ans">Accepted answers</label>
          <textarea id="q-ans" value={answers} onChange={(e) => setAnswers(e.target.value)} rows={3} required />
          <span className="hint">One per line. Marking is by exact match (ignoring capital letters and extra spaces), so list every wording you accept.</span>
        </div>
      )}
      {type === "essay" && (
        <fieldset className="field">
          <legend>Marking points (rubric)</legend>
          {rubric.map((r, i) => (
            <div className="optrow" key={i}>
              <input aria-label={`Marking point ${i + 1}`} value={r.point} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, point: e.target.value } : x)))} placeholder="What earns the mark" />
              <input aria-label={`Marks for point ${i + 1}`} type="number" min="0.5" step="0.5" style={{ width: "5.5rem" }} value={r.marks} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))} />
              {rubric.length > 1 && <button type="button" className="btn small quiet" onClick={() => setRubric(rubric.filter((_, j) => j !== i))}>Remove<span className="sr-only"> point {i + 1}</span></button>}
            </div>
          ))}
          <div className="btn-row"><button type="button" className="btn small quiet" onClick={() => setRubric([...rubric, { point: "", marks: "1" }])}>Add a point</button></div>
          <span className="hint">Total marks: <strong>{rubricTotal}</strong> (set automatically from the rubric).</span>
        </fieldset>
      )}

      {type !== "essay" && (
        <div className="field" style={{ maxWidth: "9rem" }}>
          <label htmlFor="q-marks">Marks</label>
          <input id="q-marks" type="number" min="0.5" step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} required />
        </div>
      )}
      <div className="field">
        <label htmlFor="q-expl">Explanation <span className="hint">(optional, shown after marking)</span></label>
        <textarea id="q-expl" value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} maxLength={2000} />
      </div>

      {error && <div className="note error" role="alert"><p>{error}</p></div>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save as draft"}</button>
        {onCancel && <button className="btn quiet" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
