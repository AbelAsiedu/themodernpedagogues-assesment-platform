# Implementation roadmap and status

Status as of 2026-11-10 (Phases 1, 3, 4, 5 and 6 built). Mirrors `apps/web/src/lib/roadmap.ts` (shown in the app). "Live" means built, connected to the
API and tested.

| Phase | Scope | Status |
|---|---|---|
| 1 | Accounts, sessions, roles and permissions, tenant isolation, audit log, schools, classes, design system, test infrastructure | **Done** (see below for exclusions) |
| 1 | SSO with the main site, production deployment, CI, backups rehearsed | **Not done** |
| 2 | Dashboards | **Partial** — real counts for platform staff and schools; teacher/student dashboards are basic |
| 3 | Question bank (subjects, topics, 4 question types, versioning, human review) | **Done** — 22 tests |
| 3 | AI Question Studio (OpenAI, validated drafts, quotas, usage log) | **Built, partly verified** — tested against a simulated provider and a local mock HTTP server; the **live OpenAI call has not been run** from the build sandbox (no outbound access) |
| 3b | **File import:** xlsx/csv/docx/pptx/pdf/txt/md/images (OCR) → structured question import with optional one-step quiz, and AI questions grounded in chosen parts of a file ([FILE_IMPORT.md](FILE_IMPORT.md)) | **Done, with limits** — 48 tests incl. hostile files and mutation checks; checked in a real browser with a real 60-question Excel file (imported, approved, quiz hosted and played) and three garbled PDFs via OCR. OCR needs server programs; AI-from-file uses the unverified live OpenAI call |
| 3 | Bulk/queued generation, faithful extraction of questions already inside documents | Not started |
| 4 | Quizzes, **join codes**, live and homework sessions, objective marking, **live leaderboard** (Redis + WebSocket) | **Done, with limits** — 49 tests incl. real WebSocket and Redis; checked in a real browser with 3 students at once. **No load test has been run; no capacity claim.** |
| 4 | Per-student reports/exports, joining without an account (guest), teacher-paced "next question" mode | Not started |
| 5 | Exam engine: sectioned exams, scheduling, server-owned deadlines, idempotent ordered saves, receipt, auto-submit, deterministic objective marking, exam room UI, basic control room, results release | **Done, with limits** — 34 tests incl. concurrency and lock-ordering; checked in a real browser (offline recovery, reload restore, auto-submit). **No load test; no capacity claim.** |
| 5 | Official-style BECE/WASSCE templates, pause/invigilation tools, multi-part questions | Not started (templates need verified specifications from TMP) |
| 6 | Rubric marking of written answers by a person (per-point marks, server totals, reasons and history, optimistic concurrency), AI mark *suggestions* that are never marks, release guard, analytics, CSV export, marking/analytics screens ([MARKING_AND_GRADING.md](MARKING_AND_GRADING.md)) | **Done, with limits** — 23 tests incl. concurrency and mutation checks; checked in a real browser. AI suggestions tested only against a simulated provider (**live OpenAI call never run**). **No load test.** |
| 6 | Grade boundaries/grading configurations, batch AI marking, double-marking/moderation workflow, report cards, Excel/PDF exports | Not started |
| 7 | AI management, platform settings, notifications, remaining admin tools | Not started |
| 8 | Load, concurrency and security testing, optimisation | Not started |
| 9 | Production readiness | Not started |

## Dependencies that need decisions or inputs from TMP

- **AI provider and API key** (Phase 3 onward).
- **Official BECE/WASSCE specifications.** Official-style templates must be configured from verified specifications.
  The platform must not claim WAEC affiliation or reproduce past papers/marking schemes without permission.
- **Data-protection review** for student (including minors') data before any real use.
- **Hosting accounts and the domain**.

## Definition of done

The brief's checklist is **not** met. Only the "application foundation" items (except the independent GitHub repo and
deployment documentation being verified) and part of "reliability and security" (permission and security tests for what exists) are done.
