# TMP Assessment Platform

AI-powered assessment and examination platform for The Modern Pedagogues (TMP).

> **Status: Phases 1, 3 and 4.** Accounts, permissions, schools, classes, the audit log, the **question bank**, the
> **AI Question Studio**, and **quizzes with join codes and a live leaderboard** work and are tested (132 tests). The AI Studio has
> been tested against a simulated provider only; the live OpenAI call has not been run yet. The leaderboard has not been
> load-tested, so no capacity is claimed. The BECE/WASSCE exam engine and essay/AI marking are **not built yet**. See [IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) and
> [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). Nothing is deployed.

## Layout

```
apps/api         Fastify + TypeScript API, Drizzle ORM, PostgreSQL migrations, tests
apps/web         Next.js web app (sign-in, role-aware shell, schools, users, audit log, question bank, AI Studio, quizzes, live host screen, join and play, roadmap)
packages/shared  Roles, permissions and validation schemas shared by both apps
docs/            Architecture, schema, API, security, deployment, testing
```

## Run it locally

Requires Node 22+, pnpm 10, PostgreSQL 16, Redis 7.

```bash
pnpm install
cp .env.example apps/api/.env          # edit if your database differs
createdb tmp_assessment && createdb tmp_assessment_test   # role/password must match the URLs in .env
# To enable AI: add AI_PROVIDER=openai and AI_API_KEY=... to apps/api/.env (backend only; never commit it)
pnpm db:migrate                         # apply migrations
SEED_PASSWORD='choose-one' pnpm db:seed # DEV ONLY: two demo schools, accounts *@tmp.test
pnpm dev:api                            # http://localhost:4000
pnpm dev:web                            # http://localhost:3000
pnpm test                               # API tests (rebuilds the test database each run)
pnpm typecheck
```

Dev accounts (password = your `SEED_PASSWORD`): `super@tmp.test`, `platform@tmp.test`, `academic@tmp.test`,
`admin.alpha@tmp.test`, `teacher.alpha@tmp.test`, `student.alpha@tmp.test` (and the same for `beta`).

## Where to read next

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it fits together and why
- [AUTHENTICATION_AND_PERMISSIONS.md](docs/AUTHENTICATION_AND_PERMISSIONS.md) — the permission model
- [SECURITY.md](docs/SECURITY.md) — what is protected, how it was tested, what is still open
- [TESTING.md](docs/TESTING.md) — what the tests prove
