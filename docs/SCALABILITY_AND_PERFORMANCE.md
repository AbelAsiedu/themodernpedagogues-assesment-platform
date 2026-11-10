# Scalability and performance

## Measured results
**None.** No load, concurrency or performance test has been run. **The platform makes no claim about how many
simultaneous candidates it can support.** The targets in the brief (100–500 → 10,000+) are goals only.

## What is in place that helps
- Stateless API process (sessions live in PostgreSQL), so it can be run as multiple instances.
- Connection pool (`postgres`, max 10 per process, configurable in code).
- Redis-backed rate limiting when `REDIS_URL` is set.
- Indexes on the hot lookup paths (token hash, memberships by institution, classes by institution, audit time/action/actor).

## Known bottlenecks to fix or measure first
- Session loading is 3 queries per request → cache in Redis (short TTL, invalidated on suspend/role change).
- `/admin/overview` runs several aggregate queries per call → cache or materialise at scale.
- Audit inserts are synchronous per login → consider batching if login volume is high.

## Built in Phase 4 (correct, not yet measured)
- **Leaderboard:** Redis sorted set per session. Score = `points × 1e8 + (1e8 − 1 − totalTimeMs)`, so higher points win and, on equal points, less total time wins; the participant id is the final tie-break. PostgreSQL is the record; Redis can be rebuilt from it.
- **Idempotent answers:** primary key `(participant_id, idx)` plus a row lock on the participant, so double-taps and retries cannot double-score.
- **Fan-out:** one WebSocket room per session, changes batched every 400 ms, Redis pub/sub so several API instances can serve one session. Guard rails: 5 sockets per user, 3000 per session. Players only receive the top 10 and display names.
- **Fallback:** if WebSockets are unavailable the client polls every 3 s.
- **Known cost:** each finished player's rank refresh is one HTTP request per few seconds (debounced); a busy 200+ room will make this the first thing to measure.

## Built in Phase 5 (correct, not yet measured)
- **Exam saves:** one short transaction per save (share-lock on the attempt row, upsert of the current answer guarded by `seq`, insert of a version row). No hot shared row is written; saves from different candidates never touch the same rows. Candidates' browsers debounce typing (~0.7 s) and send choices immediately; the save endpoint is limited to 600/min per user.
- **Submit:** one transaction holding an exclusive row lock, hashing the candidate's own answers. Marking is outside it and is retried by the sweeper.
- **Sweeper:** one indexed query for due attempts and one for pending marking, every 15 s per instance; safe to run on several instances (submit and marking are idempotent).
- **Known costs to measure first:** the control room's progress query (grouped over all responses of a sitting) every 5 s per open control room; `result()` is computed on demand per candidate (several small queries) when the teacher opens the marks table, so a sitting with hundreds of candidates will make that page slow; `exam_response_versions` grows with every accepted change.

## Planned for later phases (not built)
- **Queues:** BullMQ workers for marking, AI jobs, exports.
- **Load tests (none run yet, including for quizzes and exams):** scripted scenarios for login, join, quiz answering with a live board, exam start, answer saving, simultaneous submit — run at each staged target, with results recorded here.
