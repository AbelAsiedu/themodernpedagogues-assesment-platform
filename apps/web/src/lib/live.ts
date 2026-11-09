"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface BoardEntry { rank: number; name: string; points: number }
export interface LiveEvent {
  type: string; status: string; participants: number; showLeaderboard: boolean; top: BoardEntry[]; at: string; role?: string;
}

/** Where to open the WebSocket. In development the API is on :4000; behind one domain it is same-origin. */
export function liveUrl(sessionId: string) {
  const path = `/api/v1/sessions/${sessionId}/live`;
  const base = process.env.NEXT_PUBLIC_WS_BASE;
  if (base) return `${base}${path}`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return location.port === "3000" ? `${proto}//${location.hostname}:4000${path}` : `${proto}//${location.host}${path}`;
}

/**
 * Live feed for one session: WebSocket first, with automatic reconnects. If the socket can't be held open
 * (blocked by a school network, proxy, etc.) it falls back to polling the same data over plain HTTP every 3 s.
 * `connected` tells the UI which mode it is in, so it never pretends to be live when it isn't.
 */
export function useLive(sessionId: string | null) {
  const [event, setEvent] = useState<LiveEvent | null>(null);
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  const failures = useRef(0);

  useEffect(() => {
    if (!sessionId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const startPolling = () => {
      if (poll) return;
      setMode("polling");
      const tick = () => api<LiveEvent>(`/sessions/${sessionId}/leaderboard`).then((e) => !closed && setEvent(e)).catch(() => {});
      void tick();
      poll = setInterval(tick, 3000);
    };
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };

    const connect = () => {
      if (closed) return;
      try { ws = new WebSocket(liveUrl(sessionId)); } catch { failures.current++; startPolling(); return; }
      ws.onopen = () => { failures.current = 0; stopPolling(); setMode("live"); };
      ws.onmessage = (m) => {
        try { const d = JSON.parse(m.data) as LiveEvent; if (d.type === "leaderboard" || d.type === "status") setEvent(d); } catch { /* ignore */ }
      };
      ws.onclose = (e) => {
        if (closed) return;
        // 4401/4403 mean "not allowed": retrying won't help.
        if (e.code === 4401 || e.code === 4403) { startPolling(); return; }
        failures.current++;
        if (failures.current >= 2) startPolling();
        retry = setTimeout(connect, Math.min(10_000, 1000 * 2 ** failures.current));
      };
      ws.onerror = () => { /* onclose follows */ };
    };
    connect();
    return () => { closed = true; ws?.close(); stopPolling(); if (retry) clearTimeout(retry); };
  }, [sessionId]);

  return { event, mode };
}
