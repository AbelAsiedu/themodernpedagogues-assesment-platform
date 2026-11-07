# Deployment

> **Nothing has been deployed.** No GitHub remote, hosting account, domain, database or monitoring has been created
> or verified. This file is a checklist for doing so, not a record of having done so.

## Proposed arrangement (from the project brief)

Web on Vercel · API on Render (or similar) · managed PostgreSQL · managed Redis · object storage later.
Domain `assessment.themodernpedagogues.com`. These are suggestions; nothing here is verified against those platforms.

## Steps still to do

1. Create the `tmp-assessment-platform` GitHub repository and push (the sandbox's GitHub token was invalid, so this was not possible).
2. Provision PostgreSQL 16 and Redis. Create **two** database roles: a migration owner and a restricted app role (see SECURITY.md).
3. Set API env vars (ENVIRONMENT_VARIABLES.md) as platform secrets. `NODE_ENV=production`, real `WEB_ORIGINS`, `SESSION_COOKIE_DOMAIN`.
4. Run `pnpm db:migrate` as the migration owner. **Do not run `db:seed` in production** (it refuses).
5. Create the first super administrator through a one-off, audited script (**not written yet** — there is deliberately no seeded production admin).
6. Deploy the API; confirm `/health/ready`.
7. Deploy the web app with `API_URL` pointing at the API; confirm sign-in over HTTPS.
8. Restrict `trustProxy` to the platform's proxy (SECURITY.md).
9. Configure error tracking and log shipping (**not integrated**).

## Backup and recovery (to be set up and rehearsed)

- Enable the provider's automated daily backups and point-in-time recovery.
- Also take `pg_dump -Fc` snapshots before every migration.
- Restore procedure: create a new instance → `pg_restore` → point `DATABASE_URL` at it → verify `/health/ready` and a sign-in.
- **A recovery has not been rehearsed.** Do that before holding real data; document the measured recovery time.

## Rollback

Migrations are forward-only SQL. To roll back a release: redeploy the previous build, and if a migration must be undone,
write a new compensating migration — never edit an applied one.
