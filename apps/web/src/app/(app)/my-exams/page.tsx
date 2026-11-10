"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Empty, ErrorNote, Loading, PageHead, Tag } from "@/components/ui";

interface Row {
  sittingId: string; title: string; durationMinutes: number; opensAt: string; closesAt: string; phase: "upcoming" | "open" | "closed"; resultsReleased: boolean;
  session: { id: string; status: string; deadlineAt: string } | null;
}

export default function MyExams() {
  const router = useRouter();
  const list = useApi<{ exams: Row[] }>("/my/exams");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function start(id: string) {
    setBusy(id); setError(null);
    try { const r = await api<{ sessionId: string }>(`/sittings/${id}/start`, { method: "POST" }); router.push(`/exam/${r.sessionId}`); }
    catch (e) { setError(describeError(e)); setBusy(null); void list.reload(); }
  }

  return (
    <>
      <PageHead title="My exams">Exams your school has scheduled for you. The clock runs on the server, so it can't be paused by closing the page.</PageHead>
      {error && <div className="note error" role="alert"><p>{error}</p></div>}
      {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} retry={list.reload} /> : !list.data?.exams.length ? (
        <Empty title="No exams scheduled">When a teacher schedules an exam for you, it will appear here.</Empty>
      ) : (
        <div className="stack">
          {list.data.exams.map((e) => {
            const done = e.session?.status === "submitted";
            const working = e.session?.status === "in_progress";
            return (
              <div className="qcard" key={e.sittingId}>
                <div className="qcard-head">
                  <strong>{e.title}</strong>
                  <Tag tone={done ? "ok" : working || e.phase === "open" ? "wait" : "plain"}>{done ? "submitted" : working ? "in progress" : e.phase}</Tag>
                </div>
                <p className="hint">{e.durationMinutes} minutes · opens {fmtDateTime(e.opensAt)} · closes {fmtDateTime(e.closesAt)}</p>
                {!e.session && e.phase === "open" && <p className="hint">Once you press Start you have {e.durationMinutes} minutes, or until the exam closes if that comes first.</p>}
                <div className="btn-row">
                  {(working || (!e.session && e.phase === "open")) && <button className="btn" disabled={busy === e.sittingId} onClick={() => void start(e.sittingId)}>{working ? "Continue exam" : "Start exam"}</button>}
                  {done && e.session && <Link className="btn quiet" href={`/exam/${e.session.id}`}>{e.resultsReleased ? "See my result" : "See my receipt"}</Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
