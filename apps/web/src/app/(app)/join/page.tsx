"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import { PageHead } from "@/components/ui";

export default function JoinPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const nick = String(f.get("name") ?? "").trim();
      const r = await api<{ sessionId: string }>("/sessions/join", { method: "POST", body: { code: f.get("code"), displayName: nick || undefined } });
      router.push(`/play/${r.sessionId}`);
    } catch (err) { setError(describeError(err)); setBusy(false); }
  }

  return (
    <>
      <PageHead title="Join a quiz">Type the code your teacher is showing.</PageHead>
      <form className="form" onSubmit={join}>
        <div className="field">
          <label htmlFor="code">Join code</label>
          <input id="code" name="code" className="codeinput" required minLength={4} maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
        </div>
        <div className="field">
          <label htmlFor="nick">Name on the leaderboard <span className="hint">(optional)</span></label>
          <input id="nick" name="name" maxLength={24} placeholder="Defaults to your first name and last initial" />
          <span className="hint">Other students see this name, not your full name.</span>
        </div>
        {error && <div className="note error" role="alert"><p>{error}</p></div>}
        <div className="btn-row"><button className="btn bigbtn" type="submit" disabled={busy}>{busy ? "Joining…" : "Join"}</button></div>
      </form>
    </>
  );
}
