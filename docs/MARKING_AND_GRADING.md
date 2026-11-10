# Marking and grading — essay marking built; grading configurations not built

**Built (Phases 4–5):** deterministic objective marking for mcq, true/false and short answer (exact match after trimming, lower-casing and
collapsing spaces; no partial credit, no negative marking, no tolerance rules) in quizzes and exams, run after an exam submission is stored;
best-`n` selection for `answer_any` sections; results hidden until released. See [EXAMINATION_ENGINE.md](EXAMINATION_ENGINE.md).

**Built (Phase 6):** rubric marking of written answers by a person, with an optional AI *suggestion* that is never a mark; mark history;
results that exclude nothing silently; analytics and CSV export. Details are in "How essay marking works today" below.

**Not built:** grade boundaries and grading configurations, math equivalence, handwriting OCR of exam scripts, batch/automatic AI marking,
a second-marker (double-marking) workflow beyond "adjust with a recorded reason", per-student report cards. The sections after
"How essay marking works today" are the original design intent; where they say more than the list above, they are not built.

## How essay marking works today
- **Who:** anyone with `exams.manage` in the school that holds the exam (teachers and school admins). Students cannot. Other schools get a
  non-disclosing 403 (404 for platform staff, who are read-only here).
- **What is marked:** only essay answers on a *submitted* attempt where the student actually wrote something. Blank answers are not
  markable (they score nothing and don't block results). The rubric is the copy frozen into the sitting when it was scheduled; editing the
  question later does not change it.
- **How:** the marker enters a mark per rubric point (0 up to that point's marks). The **server** adds them up; a client-sent total is never
  trusted. A comment to the student is optional.
- **First mark vs change:** a first mark needs no reason. Changing a mark needs a reason (5–300 characters). Each save carries `basedOn`
  (the mark the marker was looking at); if someone else changed it meanwhile the save is refused with 409, never silently overwritten.
  Sending exactly the same marks again changes nothing and writes no history. Two markers saving an unmarked answer at the same instant:
  one wins, the other gets 409.
- **History:** every mark and change is a row in `exam_mark_events` (who, when, previous mark, new mark, reason, and the AI suggestion id if
  the marker started from one). The table is append-only: a database trigger refuses UPDATE.
- **Results:** `engine.result()` uses only `exam_marks`. Unmarked written answers show as "waiting"; in an *answer any* section the best-`n`
  choice is not made until every answered option is marked (nothing is guessed). Totals are never presented as final while any are waiting.
- **Releasing:** releasing with unmarked written answers is refused (409) unless the teacher confirms (`{allowUnmarked:true}`; the screen
  shows a "Release anyway" button). Students then see marks and any comment, never the rubric, an AI suggestion or who marked.
- **Anonymous marking:** the marking screen can hide student names (a display option only; the page still has them).

## AI suggestions (propose only)
- Optional, per answer, only when the server has an AI provider, the marker has `ai.generate`, and the answer is not yet marked.
- The prompt contains the question, the rubric and the answer text, with the answer fenced as **untrusted** text the model must not obey.
  The **student's name and email are not sent**. The answer text *is* sent to the AI vendor; schools should know that.
- The reply must match a strict schema (one value per rubric point, within each point's limit, numeric). One retry; anything else is
  rejected and nothing is saved. We never "fix" a model's numbers.
- A suggestion is stored in `ai_mark_proposals`, apart from marks. It is never counted in results and never visible to students. It only
  becomes a mark when a person saves marks (which they may edit first); then the suggestion is marked `used` and its id is recorded in the history.
- Each request counts against the same per-user daily AI quota (`ai_generations`, `params.kind = "mark_proposal"`), failures included.
- **Never run against the real OpenAI service in testing**; the tests use a simulated provider. Treat suggestions as unverified until you
  have compared them with your own marking on real scripts.

## Analytics and export
- `GET /sittings/:id/analytics`: participation; score statistics (mean, median, min, max, ten 10%-bands) over **completely marked** attempts
  only, so unmarked papers don't drag figures down; per-question answered/blank counts, average, share of marks earned, and for multiple
  choice how many chose each option.
- `GET /sittings/:id/results.csv`: one row per expected student, including those who did not start or did not submit. Cells that start
  with `= + - @` (or tab/CR) get a leading apostrophe so spreadsheets don't run them as formulas. The download is audited.

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
