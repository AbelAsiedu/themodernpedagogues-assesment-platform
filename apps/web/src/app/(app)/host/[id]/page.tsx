"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { useLive } from "@/lib/live";
import { Empty, ErrorNote, Loading, PageHead } from "@/components/ui";
import { Board, LiveBadge } from "@/components/board";

interface Detail {
  session: { id: string; joinCode: string; status: string; settings: { title: string; timePerQuestionSec: number; showLeaderboard: boolean; durationMinutes: number | null }; endsAt: string | null };
  totalQuestions: number;
  participants: { rank: number; displayName: string; fullName: string; points: number; correct: number; answered: number; finished: boolean }[];
  questions: { position: number; stem: string; type: string; answered: number; correct: number; avgMs: number }[];
}

export default function HostPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<Detail>(`/sessions/${id}`);
  const { event, mode } = useLive(id);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Refresh the detailed table (real names, per-question results) every few seconds while the game is on, and when it changes state.
  const status = event?.status ?? detail.data?.session.status;
  useEffect(() => {
    if (status === "ended") { void detail.reload(); return; }
    const t = setInterval(() => void detail.reload(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id]);

  // A live event means something changed (a join, an answer): refresh the table promptly instead of waiting for the interval.
  // Debounced so a burst of events during a busy round triggers one request, not one per event.
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => void detail.reload(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.at]);

  async function act(path: "start" | "end") {
    setBusy(true); setMsg(null);
    try { await api(`/sessions/${id}/${path}`, { method: "POST" }); await detail.reload(); }
    catch (e) { setMsg(describeError(e)); } finally { setBusy(false); }
  }

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error && !detail.data) return <ErrorNote error={detail.error} retry={detail.reload} />;
  if (!detail.data) return null;
  const d = detail.data;
  const live = event?.status ?? d.session.status;
  const count = event?.participants ?? d.participants.length;
  const finished = d.participants.filter((p) => p.finished).length;

  return (
    <>
      <p><Link href="/quizzes">← Quizzes</Link></p>
      <PageHead title={d.session.settings.title}>
        {live === "lobby" ? "Waiting for students. Share the code, then press Start." : live === "active" ? "In progress." : "Finished."}
      </PageHead>
      {msg && <div className="note error" role="alert"><p>{msg}</p></div>}

      {live !== "ended" && (
        <section className="section" aria-labelledby="code-h">
          <h2 id="code-h">Students join with this code</h2>
          <div><span className="code-display" aria-label={`Join code ${d.session.joinCode.split("").join(" ")}`}>{d.session.joinCode}</span></div>
          <p className="hint">They sign in, choose "Join a quiz" and type the code. Codes stop working when the session ends.</p>
        </section>
      )}

      <section className="section" aria-label="Controls and counts">
        <div className="stat-row">
          <div className="stat"><b>{count}</b><span>joined</span></div>
          <div className="stat"><b>{finished}</b><span>finished</span></div>
          <div className="stat"><b>{d.totalQuestions}</b><span>questions</span></div>
        </div>
        <div className="btn-row" style={{ alignItems: "center" }}>
          {live === "lobby" && <button className="btn bigbtn" disabled={busy} onClick={() => void act("start")}>Start quiz</button>}
          {live !== "ended" && !confirmEnd && <button className="btn danger" disabled={busy} onClick={() => setConfirmEnd(true)}>End session</button>}
          {live !== "ended" && confirmEnd && (
            <>
              <span role="alert"><strong>End it for everyone?</strong></span>
              <button className="btn danger" disabled={busy} onClick={() => { setConfirmEnd(false); void act("end"); }}>Yes, end now</button>
              <button className="btn quiet" onClick={() => setConfirmEnd(false)}>Keep going</button>
            </>
          )}
          <LiveBadge mode={mode} />
        </div>
        {d.session.endsAt && live !== "ended" && <p className="hint">Closes automatically at {new Date(d.session.endsAt).toLocaleString("en-GH")}.</p>}
      </section>

      <section className="section" aria-labelledby="lb-h" aria-live="polite">
        <h2 id="lb-h">Leaderboard</h2>
        <Board top={(event?.top ?? d.participants.map((p) => ({ rank: p.rank, name: p.displayName, points: p.points }))).slice(0, 15)} empty="Nobody has scored yet." />
      </section>

      <section className="section" aria-labelledby="res-h">
        <h2 id="res-h">Students</h2>
        {!d.participants.length ? <Empty title="No one has joined yet" /> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Students in this session</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Shown as</th><th scope="col">Points</th><th scope="col">Correct</th><th scope="col">Answered</th></tr></thead>
            <tbody>{d.participants.map((p) => (
              <tr key={p.rank + p.fullName}><td>{p.rank}</td><td>{p.fullName}</td><td>{p.displayName}</td><td>{p.points}</td><td>{p.correct}</td><td>{p.answered}/{d.totalQuestions}{p.finished ? " ✓" : ""}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>

      {d.questions.some((q) => q.answered > 0) && (
        <section className="section" aria-labelledby="qs-h">
          <h2 id="qs-h">How each question went</h2>
          <div className="table-wrap"><table>
            <caption className="sr-only">Per-question results</caption>
            <thead><tr><th scope="col">Question</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">Avg time</th></tr></thead>
            <tbody>{d.questions.map((q) => (
              <tr key={q.position}><td className="stem-cell">{q.stem}</td><td>{q.answered}</td><td>{q.answered ? Math.round((q.correct / q.answered) * 100) : 0}%</td><td>{(q.avgMs / 1000).toFixed(1)}s</td></tr>))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
