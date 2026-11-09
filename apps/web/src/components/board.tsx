"use client";
import type { BoardEntry } from "@/lib/live";

/** Leaderboard as marks on an exam paper: rank, name, dotted leader, points. */
export function Board({ top, empty = "No scores yet." }: { top: BoardEntry[]; empty?: string }) {
  if (!top.length) return <p className="hint">{empty}</p>;
  return (
    <ol className="board" aria-label="Leaderboard">
      {top.map((e) => (
        <li key={`${e.rank}-${e.name}`}>
          <span className="rank">{e.rank}</span>
          <span className="who-name">{e.name}</span>
          <span className="dots" aria-hidden="true" />
          <span className="pts">{e.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function LiveBadge({ mode }: { mode: "connecting" | "live" | "polling" }) {
  const text = mode === "live" ? "Live" : mode === "polling" ? "Updating every few seconds" : "Connecting…";
  return <span className={`pill ${mode === "live" ? "ok" : "wait"}`} role="status">{text}</span>;
}
