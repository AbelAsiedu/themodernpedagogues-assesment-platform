/**
 * Honest build status. Keep in sync with docs/IMPLEMENTATION_ROADMAP.md.
 * "live"    = working, backed by the API, covered by tests
 * "partial" = some of it works; see note
 * "planned" = not built yet
 */
export type Status = "live" | "partial" | "planned";

export interface Module {
  phase: number;
  name: string;
  status: Status;
  note: string;
}

export const ROADMAP: Module[] = [
  { phase: 1, name: "Accounts, sign-in and permissions", status: "live", note: "Server-enforced roles, per-school isolation, session revocation, lockout, CSRF checks." },
  { phase: 1, name: "Audit log", status: "live", note: "Append-only at the database level. Covers sign-ins, role changes and denied access." },
  { phase: 1, name: "Schools and classes", status: "live", note: "Create schools, approve them, add staff and students, build classes." },
  { phase: 1, name: "Single sign-on with the main TMP website", status: "planned", note: "Designed for a shared cookie on .themodernpedagogues.com. Not built or tested." },
  { phase: 1, name: "Production deployment", status: "planned", note: "Nothing is deployed. Runs locally only." },
  { phase: 2, name: "Dashboards", status: "partial", note: "Real counts for platform staff and schools. Teacher and student dashboards are basic." },
  { phase: 3, name: "Question bank", status: "live", note: "Subjects, topics, four question types, versioning, human review and approval. Covered by tests." },
  { phase: 3, name: "AI Question Studio", status: "partial", note: "Built (OpenAI, validated drafts, quotas, usage log) and tested against a simulated provider. The live OpenAI call has not been run from the build environment yet. Test it with your key, then rotate the key. No file/PDF/image upload or bulk queue yet." },
  { phase: 3, name: "File import: Excel, CSV, Word, PowerPoint, PDF, text, pictures", status: "live", note: "Teachers upload their own files. A table of ready-made questions (such as a Wayground/Quizizz export) is imported exactly as written, with an optional quiz made in one step; other material can ground AI-written drafts. Scanned PDFs and pictures need OCR on the server. Everything imported waits for review unless the teacher approves it. Tested; AI-from-file has only been tested with a simulated provider." },
  { phase: 4, name: "Quizzes, join codes and live leaderboard", status: "live", note: "Teachers build quizzes from approved questions and open a session with a join code; students join and play; server-side marking and timing; Redis leaderboard with WebSocket updates (polling fallback). Tested; no capacity figure is claimed." },
  { phase: 4, name: "Homework, reports and quiz history", status: "partial", note: "Timed 'homework' sessions that close by themselves work. Per-student reports, exports and long-term analytics are not built." },
  { phase: 5, name: "Exam engine: timed sittings, saved answers, automatic submission", status: "live", note: "Teachers build sectioned exams from approved questions (answer-all and answer-any rules) and schedule them for a school or class. The server owns each candidate's deadline, answers save with sequence numbers, submission is idempotent with a receipt, expired attempts are submitted automatically, and objective questions are marked after submission with no AI. Tested; no capacity figure is claimed." },
  { phase: 5, name: "BECE/WASSCE official-style templates, exam control room extras", status: "planned", note: "Official-style templates need verified specifications from TMP before they can be configured; none are claimed. A basic control room (progress, extra time, release results) exists. Pausing, invigilator notes and suspicious-activity reports are not built." },
  { phase: 6, name: "Marking, AI-assisted grading and results", status: "planned", note: "Not started." },
  { phase: 7, name: "AI management, platform settings, notifications", status: "planned", note: "Not started." },
  { phase: 8, name: "Load, concurrency and security testing", status: "planned", note: "No capacity figure is claimed. None has been measured." },
];
