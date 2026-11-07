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

## Planned for later phases (not built)
- **Answer saving:** small idempotent writes, append-only versions, write path separated from marking.
- **Leaderboard:** Redis sorted sets, score = points with a documented tie-break (earlier completion wins, encoded into the score),
  idempotency per (participant, question) enforced in both Redis and a DB unique constraint, WebSocket fan-out with batched updates.
- **Queues:** BullMQ workers for marking, AI jobs, exports.
- **Load tests:** scripted scenarios for login, exam start, answer saving, simultaneous submit — run at each staged target, with results recorded here.
