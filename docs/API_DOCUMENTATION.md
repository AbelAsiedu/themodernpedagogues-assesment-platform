# API documentation

Base path `/api/v1`. JSON in/out. Authenticated by the `tmp_session` cookie.
Cookie-authenticated **mutations** must send an allowed `Origin` (browsers do this automatically) or `x-tmp-client: web`.

Errors: `{ "error": { "code", "message", "details?" } }`. Validation failures are 400 with `details: [{ path, message }]`.
Status codes: 401 not signed in · 403 not allowed · 404 not found (platform staff only, see AUTHENTICATION_AND_PERMISSIONS.md) ·
409 conflict · 429 too many attempts / rate limited.

"Scope" = the permission is checked inside the named institution. "Platform" = needs a platform role or delegation.

| Method & path | Requires | Notes |
|---|---|---|
| GET `/health`, `/health/ready` (no prefix) | — | ready checks the database |
| POST `/auth/login` | — | `{email,password}`; sets cookie; lockout after 5 failures/15 min |
| POST `/auth/logout` | session | revokes the session |
| GET `/auth/me` | session | user, roles, platform permissions, active institutions |
| GET `/users` | users.read (platform) | `q`, `role`, `status`, `limit≤100`, `offset` |
| POST `/users` | users.create (platform) | platform role in body additionally needs users.assign_roles |
| PATCH `/users/:id/status` | users.suspend (platform) | revokes sessions when not active; not on self; platform accounts: super admin only |
| PATCH `/users/:id/platform-role` | users.assign_roles | super admin only; revokes the target's sessions |
| POST `/users/:id/permissions` | users.assign_roles | `{permission}`; super-admin-only permissions refused |
| DELETE `/users/:id/permissions/:permission` | users.assign_roles | |
| GET `/institutions` | session | all for platform readers, otherwise your own |
| POST `/institutions` | institutions.create (platform) | created as `pending` |
| GET `/institutions/:id` | institutions.read (scope) | |
| PATCH `/institutions/:id/status` | institutions.update to activate, institutions.suspend to suspend (platform) | |
| GET `/institutions/:id/members` | members.read (scope) | |
| POST `/institutions/:id/users` | members.manage (scope) | creates user + membership in one transaction; institution must be active; admins only by platform staff |
| POST `/institutions/:id/members` | members.manage (scope) **and** platform users.read | attach an existing user |
| PATCH `/institutions/:id/members/:membershipId/status` | members.manage (scope) | filtered by both ids; not on self |
| GET `/institutions/:id/overview` | members.read (scope) | live counts |
| GET `/institutions/:id/classes` | classes.read (scope) | managers see all; students only their own |
| POST `/institutions/:id/classes` | classes.manage (scope) | |
| GET `/classes/:id` | classes.read (its institution) | students only if a member |
| GET `/classes/:id/members` | classes.manage (its institution) | |
| POST `/classes/:id/members` | classes.manage (its institution) | user must be an active member of that institution |
| POST `/classes/:id/archive` | classes.manage (its institution) | |
| GET `/admin/overview` | users.read (platform) | real counts only |
| GET `/audit` | audit.read (platform) | filters: `action` prefix, `outcome`, `actorUserId`; `limit≤200` |

| GET/POST `/institutions/:id/subjects` | questions.read / subjects.manage (scope) | subjects returned with their topics |
| POST `/subjects/:id/topics` | subjects.manage (its institution) | |
| GET/POST `/institutions/:id/questions` | questions.read / questions.write (scope) | GET filters: subjectId, topicId, status, type, source, q, limit≤100, offset |
| GET `/questions/:id` | questions.read (its institution) | includes version list |
| PATCH `/questions/:id` | questions.write (its institution) | type is immutable; editing a non-draft sends it back to `needs_review` and bumps `version` |
| POST `/questions/:id/submit-for-review` | questions.write | draft/rejected → needs_review |
| POST `/questions/:id/review` | questions.review (its institution) | `{decision: approve\|reject, note?}`; only route that can approve; re-validates at approval |
| POST `/questions/:id/archive` | questions.write | |
| GET `/institutions/:id/ai/status` | ai.generate (scope) | configured?, model, quota used; never the key |
| GET `/institutions/:id/ai/generations` | ai.generate (scope) | last 50 requests |
| POST `/institutions/:id/ai/generate-questions` | ai.generate (scope) | 1–10 questions; saved as `needs_review`/`ai`; 503 unconfigured, 429 quota, 502/504 provider failure |

| GET/POST `/institutions/:id/quizzes` | quizzes.manage (scope) | POST: title, per-question seconds (5–300), shuffle options, show leaderboard, ≤100 approved question ids (essays refused) |
| GET `/quizzes/:id` · POST `/quizzes/:id/archive` | quizzes.manage (its institution) | |
| POST `/quizzes/:id/sessions` | sessions.host (its institution) | `{classId?, startNow, durationMinutes?}`; returns the join code. Live = host presses start; homework = starts now and closes after `durationMinutes` |
| GET `/institutions/:id/sessions` | sessions.host (scope) | |
| POST `/sessions/:id/start` · `/sessions/:id/end` | sessions.host (its institution) | ending releases the join code |
| GET `/sessions/:id` | sessions.host (its institution) | real names, per-question stats |
| POST `/sessions/join` | sessions.play | `{code, displayName?}`; 30/min per user; every failure is the same 404 |
| GET `/sessions/:id/play` | sessions.play + participant | current question without the key; starts the server clock |
| POST `/sessions/:id/answer` | sessions.play + participant | `{index, answer}`; idempotent; late answers score 0 |
| GET `/sessions/:id/leaderboard` | participant or host | role-filtered; same data as the WebSocket (HTTP fallback) |
| WS `/sessions/:id/live` | participant or host | origin allow-listed; close 4401 unauthenticated, 4403 not allowed, 4408 too many connections |

| GET/POST `/institutions/:id/exams` | exams.manage (scope) | POST: title, duration 5–360 min, ≤10 sections each `answer_all` or `answer_any n`, approved questions only; `official_verified` needs `sourceSpec` |
| GET `/exams/:id` · POST `/exams/:id/archive` | exams.manage (its institution) | |
| POST `/exams/:id/sittings` | exams.manage (its institution) | `{classId?, opensAt, closesAt}`; window ≥ duration; freezes the questions |
| GET `/institutions/:id/sittings` | exams.manage (scope) | with started/submitted counts |
| GET `/sittings/:id` | exams.manage (its institution) | control room: per-candidate status, answered, deadline |
| POST `/sittings/:id/cancel` | exams.manage | only before anyone has started |
| GET `/sittings/:id/results` · POST `/sittings/:id/release-results` | exams.manage | results show unmarked written answers as waiting; release only after close; with unmarked written answers it returns 409 unless the body has `{allowUnmarked:true}` |
| GET `/sittings/:id/marking` | exams.manage (its school; others 403, platform staff 404) | every submitted, non-blank written answer with its frozen rubric, mark, latest AI suggestion, counts, `ai.configured` |
| PUT `/exam-sessions/:id/marks/:position` | exams.manage | `{criteria:number[], comment|null, basedOn:number|null, reason?, proposalId?}`; 400 on shape/limits or missing reason when changing; 409 if `basedOn` is stale or the attempt isn't submitted; returns `{awarded, changed}`; audited `mark.set` / `mark.adjust` |
| GET `/exam-sessions/:id/marks/:position/history` | exams.manage | who, when, previous → new, reason, whether it started from an AI suggestion |
| POST `/exam-sessions/:id/marks/:position/ai-proposal` | exams.manage + ai.generate | stores a suggestion (never a mark); 503 no AI, 409 already marked, 429 quota, 502/504 provider; audited `mark.ai_proposal`; rate limited |
| GET `/sittings/:id/analytics` | exams.manage | participation, score statistics over completely marked papers, per-question stats |
| GET `/sittings/:id/results.csv` | exams.manage | CSV download (formula-safe), audited `sitting.export_results` |
| POST `/exam-sessions/:id/extend` | exams.manage (its institution) | `{minutes 1–120, reason}`, audited; refused once the attempt has ended |
| GET `/my/exams` | signed-in student | only sittings for their school/class |
| POST `/sittings/:id/start` | exams.take (student of that school/class) | idempotent; 409 `exam_not_open` / `exam_closed` / `exam_cancelled`; everyone else 404 |
| GET `/exam-sessions/:id` | the candidate only | questions without the key, saved answers, server clock; auto-submits if time is up |
| PUT `/exam-sessions/:id/responses/:position` | the candidate only | `{seq, answer}`; stale `seq` → 200 `applied:false`; 409 `time_up` / `exam_submitted` |
| POST `/exam-sessions/:id/submit` | the candidate only | idempotent; returns the receipt; optional `{timeUp:true}` |
| GET `/exam-sessions/:id/result` | the candidate only | receipt only until released; then marks, never the key |

### Files (Phase 3b) — see [FILE_IMPORT.md](FILE_IMPORT.md)
| Route | Permission | Notes |
|---|---|---|
| GET `/institutions/:id/uploads/capabilities` | questions.write (scope) | `{maxBytes, kinds, ocr}` |
| GET `/institutions/:id/uploads` | questions.write (scope) | summaries; never the file or full text |
| POST `/institutions/:id/uploads` | questions.write (scope) | multipart: one `file` + `confirmRights=true`. 201 new, 200 `reused:true` for an identical file; 400 no rights, 413 too large, 422 `upload_unsupported/legacy_format/unreadable/no_text/too_large` with a plain message. 20/min per user |
| GET `/uploads/:id[?subjectId=]` | questions.write (its institution) | text-section previews and the full parsed question table; with `subjectId`, rows already in the bank are flagged `duplicate` |
| POST `/uploads/:id/import-questions` | questions.write; + `questions.review` if `approve`; + `quizzes.manage` if `quiz` | `{subjectId, topicId, difficulty, rows?, approve, quiz?}` → 201 `{imported, status, skipped[], quiz}`; 409 if nothing importable |
| DELETE `/uploads/:id` | questions.write (its institution) | 204; imported questions stay |
| POST `/institutions/:id/ai/generate-questions` | ai.generate | now also accepts `uploadId` + `sectionIds` (server reads the text; foreign upload or unknown section → 400; over 12,000 chars → 400) |

No OpenAPI document is generated yet; this file is maintained by hand.

Rate limits: 300 requests/min globally (per signed-in user, or per IP when anonymous, so a classroom behind one school IP is not throttled together); 20 logins/15 min/IP (`RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`).
