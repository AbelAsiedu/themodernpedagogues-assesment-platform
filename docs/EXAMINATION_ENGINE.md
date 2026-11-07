# Examination engine — DESIGN INTENT, NOT IMPLEMENTED

Nothing in this file exists in code yet. It records the decisions to build against in Phase 5.

## Principles
1. **The server owns time.** Candidates never decide when an exam ends.
2. **Never lose an answer.** Persistence is the priority; marking is separate and can fail without harming a submission.
3. **Structure is data.** BECE/WASSCE paper shapes are configuration (templates), never hardcoded per subject.

## Structure model (planned tables)
`exam_templates` → `exams` → `exam_sections` (A, B, …) → `exam_items` (numbered question with sub-parts `(a)`, `(c)(ii)`)
→ links to versioned questions. Selection rules live on the section/group as data, e.g.
`{ type: "answer_any", count: 3, of: [group ids] }`, `{ type: "answer_all" }`, `{ type: "one_from_each_group" }`.
Templates carry a provenance label: `official_verified` | `teacher_created` | `tmp_practice`. **`official_verified` is only
allowed with a recorded source specification.** No WAEC affiliation is claimed.

## Timing (planned)
- On start, the server creates an `exam_session` and stores `started_at` and `deadline_at = min(started_at + duration + approved_extension, window_end)`.
- Every save/submit is validated against `deadline_at` using **server time**. The client countdown is cosmetic and re-synced from the server.
- A background job auto-submits expired sessions, so a closed browser or dead network still ends on time.
- Extensions and pauses are explicit, reasoned, audited actions by authorised staff.

## Answer persistence (planned)
- `PUT /sessions/:id/responses/:itemId` carries a client-generated **idempotency key** and a monotonically increasing
  **sequence number**; the server ignores stale sequences, so a delayed offline sync can't overwrite newer answers.
- Each accepted change appends to `response_versions`; the current answer is a pointer. The browser caches locally for resilience only; the server is the record.
- Submission is idempotent: unique constraint on `(session_id)` in `submissions`; a second submit returns the first receipt.
- Submit transaction: validate session + candidate + deadline → persist final responses → write submission → enqueue marking → return a receipt. AI is never in this path.

## Integrity
Randomised question/option order per candidate, session validation, single active session policy, audit of interventions,
suspicious-activity *reports* for staff review. No intrusive surveillance; no cheat-proof claims.

## Formal-exam isolation
Public rankings, instant scoring and answer reveal are off by default and cannot be enabled for high-stakes exams without an explicit, audited override.
