"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, describeError, useApi } from "@/lib/api";
import { hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead, Pill } from "@/components/ui";

interface Inst { id: string; name: string; slug: string; status: string; country: string; timezone: string }

export default function InstitutionsPage() {
  const { state } = useSession();
  const { data, error, loading, reload } = useApi<{ institutions: Inst[] }>("/institutions");
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== "ready") return null;
  const { me } = state;
  const canCreate = hasPerm(me, "institutions.create");
  const canApprove = hasPerm(me, "institutions.update");
  const canSuspend = hasPerm(me, "institutions.suspend");

  async function setStatus(i: Inst, status: "active" | "suspended") {
    setMsg(null);
    try {
      await api(`/institutions/${i.id}/status`, { method: "PATCH", body: { status } });
      setMsg({ kind: "good", text: status === "active" ? `${i.name} is approved and active.` : `${i.name} is suspended. Its members lost access immediately.` });
      await reload();
    } catch (e) {
      setMsg({ kind: "error", text: describeError(e) });
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setMsg(null);
    try {
      await api("/institutions", { method: "POST", body: { name: f.get("name"), slug: f.get("slug") } });
      setMsg({ kind: "good", text: `Created ${f.get("name")}. It stays pending until approved.` });
      form.reset();
      await reload();
    } catch (err) {
      setMsg({ kind: "error", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Institutions">New institutions start as pending. Members get no access until an administrator approves the school.</PageHead>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !data?.institutions.length ? (
        <Empty title="No institutions yet">{canCreate ? "Create the first one below." : "You haven't been added to a school."}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Institutions</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Time zone</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.institutions.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/institutions/${i.id}`}>{i.name}</Link></td>
                  <td><Pill value={i.status} /></td>
                  <td>{i.timezone}</td>
                  <td className="actions">
                    {i.status !== "active" && canApprove && <button className="btn small" onClick={() => void setStatus(i, "active")}>{i.status === "pending" ? "Approve" : "Reinstate"}<span className="sr-only"> {i.name}</span></button>}
                    {i.status === "active" && canSuspend && <button className="btn small danger" onClick={() => void setStatus(i, "suspended")}>Suspend<span className="sr-only"> {i.name}</span></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate && (
        <section className="section" aria-labelledby="create-inst">
          <h2 id="create-inst">Create an institution</h2>
          <form className="form" onSubmit={create}>
            <Field id="name" name="name" label="School name" required minLength={2} />
            <Field id="slug" name="slug" label="Short name for web addresses" required pattern="[a-z0-9]+(-[a-z0-9]+)*" hint="Lowercase letters, numbers and hyphens. For example: alpha-jhs." />
            <div className="btn-row"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create institution"}</button></div>
          </form>
        </section>
      )}
    </>
  );
}
