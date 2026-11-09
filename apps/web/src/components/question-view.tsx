"use client";
import { QUESTION_TYPE_LABEL } from "@tmp/shared";
import type { McqContent, Question } from "@/lib/questions";
import { STATUS_LABEL } from "@/lib/questions";
import { Pill } from "./ui";

export function StatusPill({ status }: { status: string }) {
  const tone = status === "approved" ? "ok" : status === "needs_review" ? "wait" : status === "rejected" ? "bad" : "plain";
  return <span className={`pill ${tone}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Read-only rendering of a question with its answer key, for review. */
export function QuestionView({ q }: { q: Question }) {
  const c = q.content as Record<string, unknown>;
  return (
    <div className="qview">
      <p className="qstem">{q.stem}</p>
      {q.type === "mcq" && (
        <ol className="opts" type="A">
          {(c as unknown as McqContent).options.map((o) => {
            const right = o.id === (c as unknown as McqContent).correctOptionId;
            return (
              <li key={o.id} className={right ? "right" : undefined}>
                <span className="optlabel">{o.id}.</span> {o.text}
                {right && <span className="tick"> ✓ correct</span>}
              </li>
            );
          })}
        </ol>
      )}
      {q.type === "true_false" && <p className="key">Answer: <strong>{(c as { correct: boolean }).correct ? "True" : "False"}</strong></p>}
      {q.type === "short_answer" && <p className="key">Accepted answers: <strong>{(c as { acceptedAnswers: string[] }).acceptedAnswers.join(" · ")}</strong></p>}
      {q.type === "essay" && (
        <ul className="rubric">
          {(c as { rubric: { point: string; marks: number }[] }).rubric.map((r, i) => (
            <li key={i}><span>{r.point}</span><span className="dots" aria-hidden="true" /><span className="m">{r.marks}</span></li>
          ))}
        </ul>
      )}
      {q.explanation && <p className="expl"><strong>Why:</strong> {q.explanation}</p>}
      <p className="qmeta">
        {QUESTION_TYPE_LABEL[q.type]} · {q.difficulty} · {q.marks} {q.marks === 1 ? "mark" : "marks"}
        {q.source === "ai" && <> · <Pill value="AI draft" /></>}
      </p>
    </div>
  );
}
