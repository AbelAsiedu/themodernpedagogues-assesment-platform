# Environment variables

Read by `apps/api/src/config.ts` (validated at startup; the server refuses to start on invalid config).
The web app reads only `API_URL` (server-side, for the proxy rewrite) and the optional public `NEXT_PUBLIC_WS_BASE` (a WebSocket address, not a secret). **No secret is ever read by the web app or sent to the browser.**

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | development | `production` turns on `Secure` cookies and refuses seeding |
| `PORT` | 4000 | API port |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `TEST_DATABASE_URL` | local test DB | used by tests; name must contain `test` |
| `REDIS_URL` | unset | Redis-backed rate limiter and live leaderboard (sorted sets + pub/sub). Without it, limits are per-process and the leaderboard is served from PostgreSQL on a single instance |
| `WEB_ORIGINS` | http://localhost:3000 | comma-separated allowed browser origins (CORS + CSRF Origin check) |
| `SESSION_COOKIE_NAME` | tmp_session | |
| `SESSION_COOKIE_DOMAIN` | unset | set to `.themodernpedagogues.com` for sibling-subdomain sharing (untested) |
| `SESSION_TTL_HOURS` | 12 | fixed session length |
| `SEED_PASSWORD` | unset | dev seed only; seeding is refused in production |
| `RATE_LIMIT_MAX` | 300 | requests/min/IP |
| `LOGIN_RATE_LIMIT_MAX` | 20 | logins/15 min/IP |
| `API_URL` (web) | http://localhost:4000 | where Next.js proxies `/api/v1/*` |
| `NEXT_PUBLIC_WS_BASE` (web) | unset | e.g. `wss://api.example.com`. Next.js's proxy does not carry WebSockets, so the live board connects to the API directly. Unset: same host (port 4000 when the page is on 3000) |

### AI (backend only — never put these in the web app or commit them)
| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | none | `none` or `openai`. With `none`, or no key, AI endpoints answer 503 and nothing else is affected |
| `AI_API_KEY` | unset | provider secret. Lives only in `apps/api/.env` (gitignored) or your host's secret store |
| `AI_MODEL` | gpt-4o-mini | model id; must support Structured Outputs |
| `AI_BASE_URL` | https://api.openai.com/v1 | override for proxies/tests |
| `AI_TIMEOUT_MS` | 60000 | per-call timeout |
| `AI_DAILY_LIMIT_PER_USER` | 30 | generation requests per user per 24 h (failed attempts count) |
| `AI_RATE_LIMIT_PER_MIN` | 10 | per-IP limit on the generate endpoint |

### Uploads and OCR (backend only)
| Variable | Default | Purpose |
|---|---|---|
| `OCR_ENABLED` | true | set `false` to refuse pictures and scanned PDFs even if the programs exist. When `true`, OCR is used only if `tesseract` and `pdftoppm` are found on the server |
| `OCR_LANG` | eng | tesseract language code(s), e.g. `eng` or `eng+fra`; the language data must be installed |
| `UPLOAD_RATE_LIMIT_PER_MIN` | 20 | uploads per user per minute |

`pnpm dev:api`, `pnpm --filter @tmp/api start`, `db:migrate` and `db:seed` read `apps/api/.env` automatically (Node `--env-file-if-exists`).
