# Known limitations

**Scope:** Phases 1, 3, 3b (file import), 4, 5 and 6 exist (accounts/permissions/schools/classes/audit; question bank and AI Question Studio; quizzes with join codes and a live leaderboard; timed exams; essay marking, analytics and CSV export). Everything else in the brief is unbuilt.

## Not built
AI paper generation, AI validation of existing questions, automatic/batch AI marking · per-student quiz reports/exports · official-style BECE/WASSCE templates ·
grade boundaries and grading configurations · per-student report cards/PDF exports · notifications ·
AI management centre · platform settings UI · global search · SSO.

## Not done
- **Live OpenAI call unverified.** The AI client is tested against a simulated provider and a local mock HTTP server only. First real run needs the key on a machine with internet; check model name (`AI_MODEL`, default `gpt-4o-mini`) is available to your account.
- AI generation runs inline in the request (max 10 questions, 60 s timeout), not in a background queue.
- Question bank is per-school only; no shared platform-wide bank, tagging beyond subject/topic, images in questions, or import/export.
- **Exams (Phase 5):**
  - Written answers need a person to mark them (see Phase 6 below). Until they do, totals are incomplete and say how many answers are waiting.
  - No official-style BECE/WASSCE templates. Structures are teacher-built; `official_verified` exists only as a guarded label that needs a recorded source specification.
  - Only `answer_all` and `answer_any n` section rules. No sub-parts `(a)(ii)`, no "one from each group", no per-section question shuffling (options are shuffled per candidate).
  - One attempt per candidate. An ended attempt cannot be reopened or extended; there is no pause/resume, invigilator notes or suspicious-activity reporting.
  - The deadline is `min(start + duration, window close)`, so a late starter gets less than the full duration. This is by design and shown on the exam list.
  - Saves are accepted 3 s past the deadline (network allowance) and the sweeper auto-submits after that. The sweeper runs every 15 s per API instance, so an attempt abandoned with a closed browser can sit unsubmitted for up to ~18 s after the deadline (it is shown as "time up" in the control room and submitted the moment anyone opens it).
  - Answers survive a refresh and short outages via browser local storage only; there is no service-worker/offline mode, and clearing site data mid-outage loses unsent answers.
  - The control room polls every 5 s; it is not a live WebSocket view. Extra time is per candidate (no bulk or class-wide extension, no stored accommodation profiles).
  - Receipts prove what the server stored (hash kept) but there is no candidate-facing way to verify a receipt yet.
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

## Marking, analytics and export (Phase 6)
- **AI mark suggestions have only been run against a simulated provider**, never the real OpenAI service. They are one answer at a time, on request; there is no batch or automatic AI marking. Suggestions can be wrong, and nobody has measured how closely they agree with teachers.
- **The answer text is sent to the AI vendor** when a suggestion is requested (no name or email). Schools that cannot allow this should not enable AI.
- No grade boundaries or grading configurations: results are marks and percentages only, with no A–F / 1–9 grades.
- No separate second-marker or moderation workflow. Another marker can change a mark with a recorded reason, and the history shows it, but there is no blind double-marking, tolerance check or moderator queue.
- Marking has no assignment of scripts to particular markers; anyone with `exams.manage` in the school can mark any answer. "Hide names" is a display option, not a guarantee of anonymity (the page still contains the names).
- A mark is one row per answer. There is no partial save of a half-marked rubric, no annotations on the student's text, and no marking of handwriting or images.
- Statistics are descriptive (mean, median, bands, facility, option counts). No discrimination index, reliability figures or cross-exam trends. Percentages use only completely marked papers.
- Export is one CSV per sitting. No Excel/PDF reports, no per-student report cards, no export of the answers themselves.
- Marking a very large sitting loads every submitted written answer into one page; fine for a class, untested at scale (no load test).

## File import (Phase 3b)
- **Only ready-made question *tables* are imported directly.** A question paper inside a PDF or Word file is read as text, but using it means AI-writing *new* questions from it; there is no "extract the existing questions faithfully" mode yet.
- Multi-answer, open-ended and poll rows in a spreadsheet are flagged and skipped; images and image links are ignored; tables inside Word/PDF are read as plain text.
- **OCR depends on `tesseract` and `pdftoppm` being installed on the server**, takes about 1 s per page (15 pages max) and can make mistakes; its output is labelled. It was checked by hand on three real garbled/scanned PDFs, and automatically only where the programs exist.
- Legacy `.doc/.xls/.ppt`, password-protected PDFs and archives are refused.
- The "I have permission" tick records what the teacher said. It is **not a copyright check**; the platform cannot tell whether material is copyrighted.
- The preview lists every parsed row on one long page (500 max), with no paging or search.
- AI-from-file generation is tested with a simulated provider only (the live OpenAI call is still unverified).

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
