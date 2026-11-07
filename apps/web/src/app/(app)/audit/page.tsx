"use client";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Empty, ErrorNote, Loading, PageHead, Pill } from "@/components/ui";

interface Entry {
  id: number; at: string; actorUserId: string | null; action: string; outcome: string; targetType: string | null; targetId: string | null; ip: string | null; metadata: Record<string, unknown>;
}

export default function AuditPage() {
  const [outcome, setOutcome] = useState("");
  const [prefix, setPrefix] = useState("");
  const qs = new URLSearchParams({ limit: "100", ...(outcome ? { outcome } : {}), ...(prefix ? { action: prefix } : {}) });
  const { data, error, loading, reload } = useApi<{ entries: Entry[] }>(`/audit?${qs}`);

  return (
    <>
      <PageHead title="Audit log">Every sign-in, role change and denied request. The database rejects any attempt to edit or delete an entry.</PageHead>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="outcome">Outcome</label>
          <select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="prefix">Action starts with</label>
          <input id="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.trim())} placeholder="auth." />
        </div>
      </div>
      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !data?.entries.length ? (
        <Empty title="No matching entries">Try clearing the filters.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Audit entries, newest first</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.at)}</td>
                  <td>{e.action}</td>
                  <td><Pill value={e.outcome} /></td>
                  <td className="pre">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}{e.targetType ? ` ${e.targetType}:${e.targetId?.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
