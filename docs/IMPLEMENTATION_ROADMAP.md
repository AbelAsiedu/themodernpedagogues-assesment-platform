# Implementation roadmap and status

Status as of 2026-11-07. Mirrors `apps/web/src/lib/roadmap.ts` (shown in the app). "Live" means built, connected to the
API and tested.

| Phase | Scope | Status |
|---|---|---|
| 1 | Accounts, sessions, roles and permissions, tenant isolation, audit log, schools, classes, design system, test infrastructure | **Done** (see below for exclusions) |
| 1 | SSO with the main site, production deployment, CI, backups rehearsed | **Not done** |
| 2 | Dashboards | **Partial** — real counts for platform staff and schools; teacher/student dashboards are basic |
| 3 | Question bank, AI Question Studio, uploads, document extraction | Not started |
| 4 | Assessments (live quiz, self-paced, homework), objective marking, live leaderboard | Not started |
| 5 | Exam engine, BECE/WASSCE templates, scheduling, exam interface, control room | Not started |
| 6 | Rubrics, AI-assisted marking, moderation, results, analytics, reports | Not started |
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
