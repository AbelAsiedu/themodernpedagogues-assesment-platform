"use client";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { INSTITUTION_ROLES } from "@tmp/shared";
import { api, describeError, useApi } from "@/lib/api";
import { ROLE_LABEL, hasPerm, useSession } from "@/lib/session";
import { Empty, ErrorNote, Field, Loading, PageHead, Pill } from "@/components/ui";

interface Inst { id: string; name: string; status: string; timezone: string }
interface Member { membershipId: string; userId: string; email: string; fullName: string; role: string; status: string }
interface Cls { id: string; name: string; level: string; academicYear: string; archivedAt: string | null }

export default function InstitutionPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useSession();
  const inst = useApi<{ institution: Inst }>(`/institutions/${id}`);
  const canSeeMembers = state.status === "ready" && hasPerm(state.me, "members.read", id);
  const members = useApi<{ members: Member[] }>(canSeeMembers ? `/institutions/${id}/members` : null);
  const classes = useApi<{ classes: Cls[] }>(`/institutions/${id}/classes`);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== "ready") return null;
  const { me } = state;
  const canManageMembers = hasPerm(me, "members.manage", id);
  const canManageClasses = hasPerm(me, "classes.manage", id);
  const canMakeAdmins = hasPerm(me, "institutions.update");
  const active = inst.data?.institution.status === "active";

  async function run(action: () => Promise<unknown>, ok: string, reset?: HTMLFormElement) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ kind: "good", text: ok });
      reset?.reset();
      await Promise.all([members.reload(), classes.reload()]);
    } catch (e) {
      setMsg({ kind: "error", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  const addMember = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(
      () => api(`/institutions/${id}/users`, { method: "POST", body: { fullName: f.get("fullName"), email: f.get("email"), password: f.get("password"), role: f.get("role") } }),
      `Added ${f.get("fullName")}.`,
      form,
    );
  };
  const addClass = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(
      () => api(`/institutions/${id}/classes`, { method: "POST", body: { name: f.get("name"), level: f.get("level"), academicYear: f.get("academicYear") } }),
      `Created class ${f.get("name")}.`,
      form,
    );
  };

  if (inst.loading) return <Loading />;
  if (inst.error) return <ErrorNote error={inst.error} retry={inst.reload} />;
  if (!inst.data) return null;

  return (
    <>
      <PageHead title={inst.data.institution.name}>
        <Pill value={inst.data.institution.status} />
      </PageHead>
      {!active && <div className="note error" role="status"><p>This school isn't active, so members can't use it yet.</p></div>}
      {msg && <div className={`note ${msg.kind}`} role={msg.kind === "error" ? "alert" : "status"}><p>{msg.text}</p></div>}

      <section className="section" aria-labelledby="classes-h">
        <h2 id="classes-h">Classes</h2>
        {classes.loading ? <Loading /> : classes.error ? <ErrorNote error={classes.error} retry={classes.reload} /> : !classes.data?.classes.length ? (
          <Empty title="No classes yet">{canManageClasses ? "Create a class below to start grouping students." : "You haven't been added to a class yet."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Classes</caption>
              <thead><tr><th scope="col">Class</th><th scope="col">Level</th><th scope="col">Academic year</th><th scope="col">State</th></tr></thead>
              <tbody>
                {classes.data.classes.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td>{c.level}</td><td>{c.academicYear}</td><td><Pill value={c.archivedAt ? "archived" : "active"} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManageClasses && active && (
          <form className="form" onSubmit={addClass}>
            <h3>Create a class</h3>
            <Field id="c-name" name="name" label="Class name" required placeholder="JHS 3A" />
            <Field id="c-level" name="level" label="Level" required placeholder="JHS 3" />
            <Field id="c-year" name="academicYear" label="Academic year" required placeholder="2026/2027" hint="For example 2026 or 2026/2027." />
            <div className="btn-row"><button className="btn" type="submit" disabled={busy}>Create class</button></div>
          </form>
        )}
      </section>

      {canSeeMembers && (
        <section className="section" aria-labelledby="members-h">
          <h2 id="members-h">People</h2>
          {members.loading ? <Loading /> : members.error ? <ErrorNote error={members.error} retry={members.reload} /> : !members.data?.members.length ? (
            <Empty title="No members yet">Add teachers and students below.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Members</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th>{canManageMembers && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {members.data.members.map((m) => (
                    <tr key={m.membershipId}>
                      <td>{m.fullName}</td><td>{m.email}</td><td>{ROLE_LABEL[m.role] ?? m.role}</td><td><Pill value={m.status} /></td>
                      {canManageMembers && (
                        <td className="actions">
                          {m.userId !== me.user.id && (m.status === "active"
                            ? <button className="btn small danger" onClick={() => void run(() => api(`/institutions/${id}/members/${m.membershipId}/status`, { method: "PATCH", body: { status: "suspended" } }), `${m.fullName} is suspended in this school.`)}>Suspend<span className="sr-only"> {m.fullName}</span></button>
                            : <button className="btn small quiet" onClick={() => void run(() => api(`/institutions/${id}/members/${m.membershipId}/status`, { method: "PATCH", body: { status: "active" } }), `${m.fullName} is active again.`)}>Reactivate<span className="sr-only"> {m.fullName}</span></button>)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canManageMembers && active && (
            <form className="form" onSubmit={addMember}>
              <h3>Add a person</h3>
              <Field id="m-name" name="fullName" label="Full name" required minLength={2} />
              <Field id="m-email" name="email" label="Email" type="email" required />
              <Field id="m-pass" name="password" label="Temporary password" type="password" required minLength={10} autoComplete="new-password" hint="At least 10 characters, with letters and numbers. Share it with them privately." />
              <div className="field">
                <label htmlFor="m-role">Role</label>
                <select id="m-role" name="role" defaultValue="student">
                  {INSTITUTION_ROLES.filter((r) => r !== "institution_admin" || canMakeAdmins).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div className="btn-row"><button className="btn" type="submit" disabled={busy}>Add person</button></div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
