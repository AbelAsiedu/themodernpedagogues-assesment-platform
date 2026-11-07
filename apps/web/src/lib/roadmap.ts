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
  { phase: 3, name: "Question bank and AI Question Studio", status: "planned", note: "Needs an AI provider and key. Not started." },
  { phase: 4, name: "Quizzes, homework and live leaderboard", status: "planned", note: "Real-time layer (WebSockets + Redis) not started." },
  { phase: 5, name: "BECE and WASSCE examination engine", status: "planned", note: "Needs verified official exam specifications before templates can be called official." },
  { phase: 6, name: "Marking, AI-assisted grading and results", status: "planned", note: "Not started." },
  { phase: 7, name: "AI management, platform settings, notifications", status: "planned", note: "Not started." },
  { phase: 8, name: "Load, concurrency and security testing", status: "planned", note: "No capacity figure is claimed. None has been measured." },
];
