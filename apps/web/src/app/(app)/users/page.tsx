"use client";
import { useState, type FormEvent } from "react";
import { PLATFORM_ROLES } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { ROLE_LABEL, hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead, Pill } from "@/components/ui";

interface U {
  id: string; email: string; fullName: string; platformRole: string | null; status: string; lastLoginAt: string | null;
}

export default function UsersPage() {
  const { state } = useSession();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const { data, error, loading, reload } = useApi<{ users: U[] }>(`/users?limit=100${applied ? `&q=${encodeURIComponent(applied)}` : ""}`);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== "ready") return null;
  const { me } = state;
  const canSuspend = hasPerm(me, "users.suspend");
  const canCreate = hasPerm(me, "users.create");
  const canAssign = hasPerm(me, "users.assign_roles");

  async function setStatus(u: U, status: "active" | "suspended") {
    setMsg(null);
    try {
      await api(`/users/${u.id}/status`, { method: "PATCH", body: { status } });
      setMsg({ kind: "good", text: `${u.fullName} is now ${status}.` });
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
      await api("/users", {
        method: "POST",
        body: { email: f.get("email"), fullName: f.get("fullName"), password: f.get("password"), platformRole: f.get("platformRole") || null },
      });
      setMsg({ kind: "good", text: `Created ${f.get("fullName")}.` });
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
      <PageHead title="Users">Platform-level accounts and anyone created outside a school. School members are managed inside their school.</PageHead>
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <form className="toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); }}>
        <div className="field">
          <label htmlFor="q">Search by name or email</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn" type="submit">Search</button>
      </form>

      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : !data?.users.length ? (
        <Empty title={applied ? "No users match that search" : "No users yet"}>{applied ? "Try a different name or email." : "Create the first account below."}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Users</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th>{canSuspend && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td>{u.email}</td>
                  <td>{u.platformRole ? ROLE_LABEL[u.platformRole] : "School member"}</td>
                  <td><Pill value={u.status} /></td>
                  <td>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</td>
                  {canSuspend && (
                    <td className="actions">
                      {u.id !== me.user.id && (u.status === "active"
                        ? <button className="btn small danger" onClick={() => void setStatus(u, "suspended")}>Suspend<span className="sr-only"> {u.fullName}</span></button>
                        : <button className="btn small quiet" onClick={() => void setStatus(u, "active")}>Reactivate<span className="sr-only"> {u.fullName}</span></button>)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate && (
        <section className="section" aria-labelledby="create-user">
          <h2 id="create-user">Create a user</h2>
          <form className="form" onSubmit={create}>
            <Field id="fullName" name="fullName" label="Full name" required minLength={2} />
            <Field id="email" name="email" label="Email" type="email" required />
            <Field id="password" name="password" label="Temporary password" type="password" required minLength={10} autoComplete="new-password" hint="At least 10 characters, with letters and numbers." />
            {canAssign && (
              <div className="field">
                <label htmlFor="platformRole">Platform role</label>
                <select id="platformRole" name="platformRole" defaultValue="">
                  <option value="">None (school member)</option>
                  {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
            )}
            <div className="btn-row"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create user"}</button></div>
          </form>
        </section>
      )}
    </>
  );
}
