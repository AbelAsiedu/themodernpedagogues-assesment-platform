# Security

## Implemented and tested

| Control | How | Test |
|---|---|---|
| Password storage | Argon2id | login tests |
| Sessions | random 256-bit token, hash stored, HttpOnly + SameSite=Lax (+Secure in prod), revocable | logout/suspend tests |
| Immediate revocation | status re-read each request; suspend/role change revokes sessions | `auth.test.ts` |
| Brute force | per-email lockout (DB) + per-IP rate limit (Redis when configured) | lockout test |
| User enumeration | identical responses, equalised timing | `auth.test.ts` |
| CSRF | SameSite=Lax + Origin allow-list on cookie-authenticated mutations | 2 tests |
| Authorization | server-side `can()`; web hides UI only | unit + integration |
| Tenant isolation | scope on every query/object; same 403 for missing vs foreign | `tenant-isolation.test.ts` |
| Privilege escalation | super-admin-only permissions, no self-change, platform accounts protected | `privileges-and-audit.test.ts` |
| Audit | append-only trigger; no passwords/hashes stored | audit tests |
| Input validation | Zod on every body/query/param | 400 tests |
| Headers | `@fastify/helmet` | smoke test |
| Error handling | generic 500s; request log redacts cookies | by design |
| Secrets | none in the repo or the client bundle (grepped) | build check |

## Mutation testing
Two deliberate breaks of `can()` (ignore institution scope; allow delegating super-admin-only permissions) made
6 and 1 tests fail respectively, then were reverted. The tests do detect these regressions.

## Live quizzes (Phase 4) — what is protected and tested

| Concern | Control | Evidence |
|---|---|---|
| Answer key leaking to players | player views are built by `publicQuestion`, which strips the key; the key is returned only with feedback after that student has answered | unit + route tests; mutation check (leaking the key fails 2 tests) |
| Guessing join codes | 6 chars from a 31-symbol alphabet (~887 million combinations), `crypto.randomInt`, 30 attempts/min per user, **identical** 404 for unknown/ended/other-school codes, codes released when a session ends | tests; this limits guessing but is not a substitute for school/class membership checks, which also apply |
| Joining another school's quiz | join requires membership of the session's school (and class, if restricted) | tenant tests |
| Double-submit / replay / racing taps | PK `(participant_id, idx)` + row lock; replays return the first result | concurrency test; mutation check (removing the lock fails it) |
| Cheating the clock | server owns `question_served_at`; late answers score 0 | tests |
| WebSocket abuse | Origin allow-list (cross-site hijacking), session cookie auth, 1 KB max message, 5 sockets/user, 3000/session, role-filtered payloads (players: top 10 + display names only; nothing if the board is hidden) | real-socket tests |
| Student privacy | classmates see only display names; real names go to the teacher view only | tests |

**Not covered:** no load/abuse test of the hub; display names are student-chosen (regex-limited, no profanity filter); a student can share the
code with someone in the same school; there is no proctoring and none is claimed.

## Exams (Phase 5) — what is protected and tested

| Concern | Control | Evidence |
|---|---|---|
| Candidate seeing the key or another's work | candidate view built by `publicQuestion`; attempts are readable/writable only by their owner (everyone else, including staff, gets 404) | route tests |
| Changing the deadline | set on the server at start; only an audited staff extension (reason required) moves it; clients cannot send a time | tests |
| Changing answers after submission | save takes a shared lock, submit an exclusive one; receipt hash must equal stored answers | deterministic lock-ordering test + racing test + mutation checks |
| Replay / out-of-order saves | `seq` guard in the upsert | tests + mutation check |
| Double submit | exclusive lock + PK on `exam_submissions` | concurrent-submit test |
| Early results / key disclosure | results hidden until a teacher releases them after close; released output never includes keys or explanations | tests |
| Other schools / classes | sittings invisible (404) outside the school or class | tests |
| Mislabelled auto-submit | client "time up" flag only trusted when the server clock agrees | test |

**Not covered:** no proctoring, tab-switch or device checks (none are claimed); local-storage backup of unsent answers is readable by anyone using the same browser profile; no load/abuse testing.

## Marking and export (Phase 6) — what is protected and tested

| Concern | Control | Evidence |
|---|---|---|
| Marking by the wrong person | every marking, history, AI and export route resolves the exam's school server-side and needs `exams.manage` there; other schools get a non-disclosing 403 | tests incl. permission narrowing and mutation check |
| Client choosing the total or the rubric | the server sums the per-point values and checks them against the rubric frozen in the sitting | tests |
| Two markers overwriting each other | `basedOn` compare under a row lock; first-mark race resolved by a unique key (one 409) | tests incl. simultaneous request |
| Silent changes to marks | reason required, append-only `exam_mark_events` (trigger refuses UPDATE), audit entries | tests |
| AI deciding marks | suggestions live in their own table, are never read by results, never sent to students; only a person's save makes a mark | tests |
| Prompt injection inside an answer | answer fenced and labelled untrusted; output validated and bounded; the mark is still a person's decision | tests |
| Student identity sent to the AI vendor | name and email are not in the prompt; **the answer text is** | test (names absent) |
| Spreadsheet formula injection via names | cells starting `= + - @ tab CR` get a leading apostrophe; safe file name; no-store; download audited | tests incl. mutation check |
| Early or unsafe release | releasing with unmarked written answers needs explicit confirmation | tests |

**Not covered:** answer text reaches a third party when AI suggestions are used; no marker assignment or blind marking enforcement; no load testing.

## File uploads (Phase 3b) — what is protected and tested
Details in [FILE_IMPORT.md](FILE_IMPORT.md).

| Concern | Control | Evidence |
|---|---|---|
| Disguised files | type decided from content (magic bytes + zip entries), never name or claimed type; legacy OLE, executables, archives and binary-as-text refused | tests |
| Zip bombs | per-part 25 MB and total 60 MB budgets, 2,000 parts max, checked from the zip directory before inflating; fflate truncates at the declared size, so lying headers cannot over-allocate | tests (one huge part; many parts adding up) |
| CPU exhaustion from malformed XML | no XML parser; linear `indexOf` scans only (earlier lazy-regex scans could go quadratic and were replaced) | test with 150,000 unclosed tags finishes in well under 1.5 s |
| XXE / entity expansion | no XML parser; only five named and numeric entities are decoded | by design |
| Command injection via OCR | `execFile` with argument arrays, no shell; temp dir 0700, removed in `finally`; file names never used in paths; 60 s timeout; 2 concurrent jobs | code review, OCR test |
| Image bombs | PNG/JPEG header dimensions checked (16 MP max) before OCR | test |
| Cross-school access | uploads authorised against their own institution, non-disclosing 403; AI route reads only the caller's school's uploads and sends only the chosen sections | tests + mutation checks |
| Prompt injection from file text | text is fenced as untrusted data in the AI prompt; output is always `needs_review` | test |
| Silent truncation | selections over 12,000 characters are refused | test |
| Abuse | 5 MB limit, 1 file/request, 20 uploads/min/user, audited | tests |
| Copyright | teacher must tick a confirmation, stored with a timestamp and audited. **This is a record, not verification** | test |

**Not covered:** no virus scanning (files are parsed, never executed or stored); the original file is not retained, so there is nothing to re-scan.

## NOT done — do before real student data

- **Separate DB roles.** The app currently connects as the table owner, who can drop the audit trigger. Use a
  migration-owner role and a restricted app role.
- **`trustProxy: true`** trusts any `X-Forwarded-For`. Safe only behind a proxy you control that overwrites it;
  otherwise per-IP limits can be spoofed. Restrict to your proxy's address.
- **No password reset / change / MFA.** Seed passwords must never be used outside development.
- **No fixed Content-Security-Policy tuning for the web app**; helmet defaults apply to the API only. The Next.js app needs its own CSP.
- **No dependency or malware scanning, no pen test, no file-upload handling (no uploads exist yet).**
- **Session cache:** three queries per request; fine now, a bottleneck at scale.
- **Data protection:** no consent flow, retention or deletion policy, no Ghana Data Protection Act review.
  The platform will hold minors' data — this needs legal review before launch.
- **Audit denial writes are fire-and-forget** and can be lost if the process dies at that instant.
