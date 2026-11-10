# Examination engine (Phase 5)

What is **built and tested** is described first. What is **not built** is listed at the end. Nothing here claims WAEC
affiliation, and the platform ships no official papers or marking schemes.

## Principles
1. **The server owns time.** Candidates never decide when an exam ends.
2. **Never lose an answer.** Saving is small, idempotent and ordered; marking is separate and can fail without harming a submission.
3. **Structure is data.** Section rules are stored as data, not coded per subject.
4. **No AI in the submission path.** Submission and objective marking are deterministic. AI is not used anywhere in the exam engine.

## Model (migration 0004)
`exams` → `exam_sections` (`answer_all` | `answer_any n`) → `exam_items` (pinned `question_version`).
A **sitting** (`exam_sittings`) schedules an exam for a school or class with an opening and closing time and **freezes a copy**
of every question (content, key, marks) in `sitting_items`, so later bank edits, archiving or deleting the exam never change what
candidates sit. A candidate's attempt is an `exam_session`; current answers are `exam_responses`, every accepted change is
kept in `exam_response_versions`, the sealed submission is `exam_submissions`, and per-item marks are `exam_marks`.

Provenance: `teacher_created` | `tmp_practice` | `official_verified`. The database refuses `official_verified` unless a source
specification is recorded. **No official-style template is shipped**: those need specifications verified by TMP.

## Timing
- On **Start** the server sets `deadline_at = min(now + duration, window closes)` and stores it. Starting again returns the same attempt.
- A save is accepted until `deadline + 3 s` (network allowance, `SAVE_GRACE_MS`); later saves are refused with `time_up` and the attempt is auto-submitted at once.
- The browser's countdown is cosmetic: it is drawn from the server's clock offset and re-synced every 30 s (which also picks up extra time).
- A **sweeper** (every 15 s per API instance; safe to run on many instances at once) auto-submits attempts past `deadline + 3 s`, so a closed browser or dead connection still ends on time, and finishes any marking left pending. Opening an expired attempt also auto-submits it immediately.
- **Extra time** is a staff action (`exams.manage`), 1–120 minutes, with a required reason, written to the audit log. An ended attempt is never reopened or extended.

## Saving answers
`PUT /exam-sessions/:id/responses/:position` with `{seq, answer}`. The row is upserted only where the stored `seq` is lower, so
a delayed retry or an offline sync can't overwrite a newer answer (a stale save is a harmless 200 with `applied:false`). Saves
hold a shared lock on the attempt row and never update it (two saves upgrading shared locks would deadlock; this was found and
fixed by a concurrency test), and submit takes the exclusive lock, so **nothing can change after a submission is sealed**.
The browser keeps unsent changes in local storage and retries with backoff; the server is the record.

## Submitting
Idempotent (`exam_submissions` is keyed by session). Under the exclusive lock it hashes the final answers (SHA-256, kept as `content_hash`),
writes a receipt (`XXXXX-XXXXX`) and flips the status. Marking runs **after commit**, in the background, and is retried by the sweeper.
A submit pressed after the deadline is recorded as `auto`; the page's own "time is up" submit is recorded as `auto` only when the
server's clock agrees (within 2 s).

## Marking and results
- mcq, true/false and short answer are marked deterministically (same rules as quizzes). **Essays get no automatic mark.** A person marks them against the frozen rubric ([MARKING_AND_GRADING.md](MARKING_AND_GRADING.md)); until then totals exclude them and the result says how many answers are waiting. Releasing results with unmarked written answers needs an explicit confirmation.
- `answer_any n`: of the answered items, the best `n` count (candidates are told this up front). Every item in such a section must carry equal marks. If an unmarked essay could change the choice, that section reports *pending* rather than guessing.
- **Formal-exam isolation:** results are hidden from candidates (they see only their receipt) until a teacher releases them, and release is only allowed after the exam closes. Released results show marks per section and item, **never the answer key or explanations.**

## Integrity (what exists)
Per-candidate option shuffling, one attempt per candidate, server-side window and class checks, non-disclosing 404s, audit records for create/schedule/start/submit/auto-submit/extend/release. There is **no** proctoring, tab-switch detection or cheat-proof claim.

## NOT built
Official-style BECE/WASSCE templates (need verified specs) · pause/resume, invigilator notes, suspicious-activity reports · multi-part sub-questions `(a)(ii)` and "one from each group" rules · per-candidate question shuffling within sections · moderation/double-marking, grade boundaries · accommodation profiles (only ad-hoc extra time) · offline-first/service-worker mode (answers survive a refresh and short outages via local storage only) · load tests (**no capacity figure exists**).
