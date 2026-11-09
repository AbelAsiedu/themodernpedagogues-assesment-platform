"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import { useLive } from "@/lib/live";
import { ErrorNote, Loading, PageHead } from "@/components/ui";
import { Board, LiveBadge } from "@/components/board";

type Option = { id: string; text: string };
interface Active {
  status: "active"; index: number; total: number; limitSec: number; remainingMs: number; points: number; showLeaderboard: boolean; title: string;
  question: { type: "mcq" | "true_false" | "short_answer"; stem: string; marks: number; options?: Option[] };
}
interface Done { status: "finished" | "ended"; result: { points: number; correct: number; answered: number; total: number }; showLeaderboard: boolean; title: string }
interface Lobby { status: "lobby"; showLeaderboard: boolean; title: string }
type Play = Active | Done | Lobby;
interface Result { correct: boolean; late: boolean; points: number; totalPoints: number; finished: boolean; correctAnswer: { optionId?: string; value?: boolean; text?: string } | null; explanation: string | null; rank: number | null }
type Given = { optionId: string } | { value: boolean } | { text: string } | null;

export default function PlayPage() {
  const { id } = useParams<{ id: string }>();
  const { event, mode } = useLive(id);
  const [play, setPlay] = useState<Play | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ r: Result; given: Given } | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const deadline = useRef(0);
  const submitted = useRef(false);

  const load = useCallback(async () => {
    try {
      const p = await api<Play>(`/sessions/${id}/play`);
      setPlay(p); setError(null); setResult(null); submitted.current = false;
      if (p.status === "active") deadline.current = Date.now() + p.remainingMs;
    } catch (e) { setError(e); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  // When the teacher starts (or ends) the session, move on without a refresh.
  useEffect(() => { if (event && play && event.status !== play.status && !result) void load(); }, [event?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep "your rank" current as others answer. Debounced, and only for players who already have a rank and can see the board,
  // so a busy round costs each student at most one small request every few seconds.
  useEffect(() => {
    if (!event || rank == null || !play?.showLeaderboard) return;
    const t = setTimeout(() => {
      api<{ me?: { rank: number | null } }>(`/sessions/${id}/leaderboard`).then((r) => { if (r.me?.rank != null) setRank(r.me.rank); }).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [event?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lobby fallback if no live feed at all.
  useEffect(() => { if (play?.status !== "lobby") return; const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [play?.status, load]);

  const answer = useCallback(async (given: Given) => {
    if (play?.status !== "active" || submitted.current) return;
    submitted.current = true; setBusy(true);
    try {
      const r = await api<Result>(`/sessions/${id}/answer`, { method: "POST", body: { index: play.index, answer: given } });
      setResult({ r, given }); setRank(r.rank);
    } catch (e) { submitted.current = false; setError(e); } finally { setBusy(false); }
  }, [id, play]);

  // Countdown. The server owns the real clock; this only draws it and sends "no answer" when it hits zero.
  useEffect(() => {
    if (play?.status !== "active" || result) return;
    const t = setInterval(() => {
      const ms = deadline.current - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) void answer(null);
    }, 200);
    return () => clearInterval(t);
  }, [play, result, answer]);

  if (error && !play) return <ErrorNote error={error} retry={() => void load()} />;
  if (!play) return <Loading />;

  const board = play.showLeaderboard ? event?.top ?? [] : [];
  return (
    <>
      <PageHead title={play.title}>{play.status === "lobby" ? "You're in." : play.status === "active" ? `Question ${play.index + 1} of ${play.total}` : "Finished"}</PageHead>
      {error ? <div className="note error" role="alert"><p>{describeError(error)}</p></div> : null}

      {play.status === "lobby" && (
        <div className="play"><div className="empty"><strong>Waiting for your teacher to start…</strong><p>Keep this page open. The quiz will begin by itself.</p></div>
          {event && <p className="hint">{event.participants} student{event.participants === 1 ? "" : "s"} joined</p>}</div>
      )}

      {play.status === "active" && (
        <div className="play">
          <div className={`timer ${left < 6000 && !result ? "low" : ""}`} role="timer" aria-label="Time left"><i style={{ width: `${result ? 0 : Math.min(100, (left / (play.limitSec * 1000)) * 100)}%` }} /></div>
          <p className="qstem">{play.question.stem}</p>
          <div className="answers">
            {play.question.type === "mcq" && play.question.options!.map((o, i) => {
              const mine = result && "optionId" in (result.given ?? {}) && (result.given as { optionId: string }).optionId === o.id;
              const right = result?.r.correctAnswer?.optionId === o.id;
              return (
                <button key={o.id} className={`ans-btn ${result ? (right ? "right" : mine ? "wrong" : "") : ""}`} disabled={!!result || busy} onClick={() => void answer({ optionId: o.id })}>
                  <span className="letter">{"ABCDEF"[i]}</span> {o.text}
                </button>
              );
            })}
            {play.question.type === "true_false" && [true, false].map((v) => {
              const mine = result && result.given && "value" in result.given && result.given.value === v;
              const right = result?.r.correctAnswer?.value === v;
              return <button key={String(v)} className={`ans-btn ${result ? (right ? "right" : mine ? "wrong" : "") : ""}`} disabled={!!result || busy} onClick={() => void answer({ value: v })}>{v ? "True" : "False"}</button>;
            })}
          </div>
          {play.question.type === "short_answer" && !result && <ShortAnswer disabled={busy} onSubmit={(t) => void answer({ text: t })} />}

          {result && (
            <div className={`feedback ${result.r.correct ? "" : "bad"}`} role="status">
              <strong>{result.r.late ? "Too late" : result.r.correct ? "Correct!" : result.given ? "Not quite" : "Time's up"} {result.r.points > 0 ? `+${result.r.points}` : ""}</strong>
              {!result.r.correct && result.r.correctAnswer && <p>Answer: <b>{result.r.correctAnswer.text ?? (result.r.correctAnswer.value === undefined ? (play.question.options?.find((o) => o.id === result.r.correctAnswer!.optionId)?.text ?? "") : result.r.correctAnswer.value ? "True" : "False")}</b></p>}
              {result.r.explanation && <p>{result.r.explanation}</p>}
              <p className="hint">Total {result.r.totalPoints} points{rank ? ` · rank ${rank}` : ""}</p>
              <div className="btn-row"><button className="btn bigbtn" onClick={() => void load()} autoFocus>{result.r.finished ? "See my result" : "Next question"}</button></div>
            </div>
          )}
        </div>
      )}

      {(play.status === "finished" || play.status === "ended") && (
        <div className="play">
          <div className="stat-row">
            <div className="stat"><b>{play.result.points}</b><span>points</span></div>
            <div className="stat"><b>{play.result.correct}/{play.result.total}</b><span>correct</span></div>
            {rank && play.showLeaderboard && <div className="stat"><b>{rank}</b><span>your rank</span></div>}
          </div>
          {play.status === "finished" && <p>{event?.status === "ended" ? "The quiz has ended." : "You've answered everything. The leaderboard keeps updating while others finish."}</p>}
          {play.status === "ended" && play.result.answered < play.result.total && <p className="hint">The quiz ended before you answered every question.</p>}
        </div>
      )}

      {play.showLeaderboard && play.status !== "lobby" && (
        <section className="section" aria-labelledby="lb-h" aria-live="polite" style={{ marginTop: "1.5rem" }}>
          <div className="section-head"><h2 id="lb-h">Leaderboard</h2><LiveBadge mode={mode} /></div>
          <Board top={board} empty="Scores will appear here." />
        </section>
      )}
    </>
  );
}

function ShortAnswer({ onSubmit, disabled }: { onSubmit(t: string): void; disabled: boolean }) {
  const [text, setText] = useState("");
  const go = (e: FormEvent) => { e.preventDefault(); onSubmit(text); };
  return (
    <form className="form" onSubmit={go}>
      <div className="field"><label htmlFor="sa">Your answer</label><input id="sa" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} autoComplete="off" autoFocus /></div>
      <div className="btn-row"><button className="btn bigbtn" type="submit" disabled={disabled}>Submit</button></div>
    </form>
  );
}
