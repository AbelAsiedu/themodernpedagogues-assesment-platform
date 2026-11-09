# Known limitations

**Scope:** Phases 1, 3 and 4 exist (accounts/permissions/schools/classes/audit; question bank and AI Question Studio; quizzes with join codes and a live leaderboard). Everything else in the brief is unbuilt.

## Not built
AI paper generation, AI marking, AI validation of existing questions, document/PDF/image upload and OCR · per-student quiz reports/exports · BECE/WASSCE exam engine ·
exam interface and timers · marking and AI grading · results and analytics · reports/exports · notifications ·
file uploads/OCR · AI management centre · platform settings UI · global search · SSO.

## Not done
- **Live OpenAI call unverified.** The AI client is tested against a simulated provider and a local mock HTTP server only. First real run needs the key on a machine with internet; check model name (`AI_MODEL`, default `gpt-4o-mini`) is available to your account.
- AI generation runs inline in the request (max 10 questions, 60 s timeout), not in a background queue.
- Question bank is per-school only; no shared platform-wide bank, tagging beyond subject/topic, images in questions, or import/export.
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
