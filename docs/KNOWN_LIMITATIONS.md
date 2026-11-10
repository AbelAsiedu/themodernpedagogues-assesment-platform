# Known limitations

**Scope:** Phases 1, 3, 4 and 5 exist (accounts/permissions/schools/classes/audit; question bank and AI Question Studio; quizzes with join codes and a live leaderboard; timed exams). Everything else in the brief is unbuilt.

## Not built
AI paper generation, AI marking, AI validation of existing questions, document/PDF/image upload and OCR · per-student quiz reports/exports · official-style BECE/WASSCE templates ·
exam interface and timers · marking and AI grading · results and analytics · reports/exports · notifications ·
file uploads/OCR · AI management centre · platform settings UI · global search · SSO.

## Not done
- **Live OpenAI call unverified.** The AI client is tested against a simulated provider and a local mock HTTP server only. First real run needs the key on a machine with internet; check model name (`AI_MODEL`, default `gpt-4o-mini`) is available to your account.
- AI generation runs inline in the request (max 10 questions, 60 s timeout), not in a background queue.
- Question bank is per-school only; no shared platform-wide bank, tagging beyond subject/topic, images in questions, or import/export.
- **Exams (Phase 5):**
  - **Essays are saved but never marked.** There is no manual or AI marking yet (Phase 6), so teacher and student totals exclude essay marks and say how many answers are waiting. Results should not be treated as final while any are pending.
  - No official-style BECE/WASSCE templates. Structures are teacher-built; `official_verified` exists only as a guarded label that needs a recorded source specification.
  - Only `answer_all` and `answer_any n` section rules. No sub-parts `(a)(ii)`, no "one from each group", no per-section question shuffling (options are shuffled per candidate).
  - One attempt per candidate. An ended attempt cannot be reopened or extended; there is no pause/resume, invigilator notes or suspicious-activity reporting.
  - The deadline is `min(start + duration, window close)`, so a late starter gets less than the full duration. This is by design and shown on the exam list.
  - Saves are accepted 3 s past the deadline (network allowance) and the sweeper auto-submits after that. The sweeper runs every 15 s per API instance, so an attempt abandoned with a closed browser can sit unsubmitted for up to ~18 s after the deadline (it is shown as "time up" in the control room and submitted the moment anyone opens it).
  - Answers survive a refresh and short outages via browser local storage only; there is no service-worker/offline mode, and clearing site data mid-outage loses unsent answers.
  - The control room polls every 5 s; it is not a live WebSocket view. Extra time is per candidate (no bulk or class-wide extension, no stored accommodation profiles).
  - Receipts prove what the server stored (hash kept) but there is no candidate-facing way to verify a receipt yet, and no result exports or analytics.
  - **No load or concurrency capacity testing.** Correctness under a handful of concurrent writers is tested; capacity is unknown. Per-save cost is one small transaction (a row share-lock, an upsert and an insert).
- **Quizzes (Phase 4):**
  - Students need an account and must be in the school (and the class, if the session is restricted). There is no guest/anonymous join.
  - Play is **self-paced** within a session (each student has their own shuffled order and server-side per-question clock). There is no teacher-paced "everyone moves to the next question together" mode.
  - Only mcq, true/false and short-answer are used. Essay questions are excluded from quizzes (they cannot be auto-marked).
  - Short-answer marking is exact match after trimming, lower-casing and collapsing spaces. It does not forgive spelling mistakes or synonyms; teachers should list accepted variants.
  - Quiz content is frozen when a session is opened; later edits to a question do not change a running or finished session.
  - **The live leaderboard and WebSocket hub have never been load-tested.** The hub enforces 5 sockets per user and 3000 per session, but these are guard rails, not measured capacity. Each player's "your rank" is refreshed with one debounced HTTP request every few seconds, which will cost more as classes grow; measure before relying on it for large rooms.
  - The leaderboard lives in Redis for speed; PostgreSQL is the record. If Redis is down the board falls back to the database (slower); if the key is lost it is rebuilt from the database.
  - Points reward speed (up to +50% for answering fast). Teachers can hide the board, but there is no per-student fairness adjustment for slow devices or networks beyond a 2 s grace.
  - The WebSocket needs the API reachable from the browser. In development that is port 4000 (or set `NEXT_PUBLIC_WS_BASE`). If the socket is blocked the page falls back to polling every 3 s and the badge says so.
  - The leaderboard is for classroom quizzes only. It is not used for formal exams (see EXAMINATION_ENGINE.md).
- The pasted API key appeared in a chat transcript. **Rotate it** after testing.
- Nothing deployed; no domain, HTTPS, monitoring or CI.
- No web/UI automated tests and no committed browser E2E (the multi-student flow was run by a throwaway script and screenshots); no load tests. **No capacity claim is made.**
- Backup/recovery not set up or rehearsed.
- First production super-admin bootstrap script not written.

## Security/behaviour caveats
See SECURITY.md. Highlights: app DB role is the table owner in dev; `trustProxy: true`; no password reset or MFA;
per-email lockout can be used to lock someone out for 15 minutes; teachers can list all members of their school;
3 queries per request for session loading; no consent/retention policy for student data.

## Accessibility
Built with labelled controls, visible focus, 44px targets, skip link, reduced-motion support and a legible typeface,
but **not audited** with a screen reader or automated checker. Approved-accommodation features (extra time, etc.) don't exist yet.

## Design notes
- The sidebar lists only working pages; unbuilt modules appear on the Roadmap page, not as dead links.
- Dates use `en-GH` formatting in the viewer's time zone.
- Slashed zeros in numerals come from the Atkinson Hyperlegible typeface on purpose.
