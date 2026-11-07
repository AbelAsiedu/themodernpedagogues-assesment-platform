# Known limitations

**Scope:** only Phase 1 exists. Everything in the brief beyond accounts/permissions/schools/classes/audit is unbuilt.

## Not built
Question bank · AI generation/validation · assessments and quizzes · live leaderboard · BECE/WASSCE exam engine ·
exam interface and timers · marking and AI grading · results and analytics · reports/exports · notifications ·
file uploads/OCR · AI management centre · platform settings UI · global search · SSO.

## Not done
- GitHub repository not created or pushed (invalid token in the sandbox). Only a local git repository exists.
- Nothing deployed; no domain, HTTPS, monitoring or CI.
- No web/UI automated tests; no browser E2E; no load or concurrency tests. **No capacity claim is made.**
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
