# Marking and grading — DESIGN INTENT, NOT IMPLEMENTED

Nothing here exists in code. Decisions for Phase 6.

## Objective marking
Deterministic code against approved answer keys — no AI. Rules as data per question: exact match, accepted alternatives,
numeric tolerance, partial credit, negative marking (only when explicitly configured). Math equivalence via a symbolic
check, not a language model.

## Subjective marking
- AI only ever *proposes* a mark against an **approved rubric** (points, marks per point, accepted alternatives, method vs accuracy marks).
- Output is schema-validated: `{ awarded_per_criterion[], proposed_total, reasoning, missing_points[], confidence }`.
  Anything unparseable or low-confidence goes to the human queue.
- AI marks are stored separately from teacher-final marks and are never shown to students as final.
- Every adjustment records original AI mark, final mark, reason, reviewer and time. Rubric versions are pinned to each marking record
  along with model and prompt version.
- OCR/handwriting: low-confidence text is never treated as the student's confirmed answer; it is flagged for review.

## Results
Total/percentage/section scores computed server-side from final marks only, with explicit handling of optional-question selection
(only the required number of answered optional questions count; no double counting). Grades only where an approved grading
configuration exists. Results are hidden until released by an authorised person.

## Failure isolation
Marking runs from a queue after submission is safely stored. AI downtime delays marking; it never affects a submission.
