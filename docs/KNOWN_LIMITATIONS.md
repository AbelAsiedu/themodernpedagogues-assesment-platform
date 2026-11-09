# Known limitations

**Scope:** Phases 1 and 3 exist (accounts/permissions/schools/classes/audit; question bank and AI Question Studio). Everything else in the brief is unbuilt.

## Not built
AI paper generation, AI marking, AI validation of existing questions, document/PDF/image upload and OCR · assessments and quizzes · live leaderboard · BECE/WASSCE exam engine ·
exam interface and timers · marking and AI grading · results and analytics · reports/exports · notifications ·
file uploads/OCR · AI management centre · platform settings UI · global search · SSO.

## Not done
- **Live OpenAI call unverified.** The AI client is tested against a simulated provider and a local mock HTTP server only. First real run needs the key on a machine with internet; check model name (`AI_MODEL`, default `gpt-4o-mini`) is available to your account.
- AI generation runs inline in the request (max 10 questions, 60 s timeout), not in a background queue.
- Question bank is per-school only; no shared platform-wide bank, tagging beyond subject/topic, images in questions, or import/export.
- Short-answer marking rules (exact match, case/space-insensitive) are not yet implemented as a marker; only the answer data is stored.
- The pasted API key appeared in a chat transcript. **Rotate it** after testing.
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
