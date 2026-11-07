"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, describeError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { state, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === "ready") router.replace("/overview");
  }, [state, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { email: form.get("email"), password: form.get("password") } });
      await refresh();
      router.replace("/overview");
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <aside className="signin-side">
        <span className="brand">The Modern Pedagogues</span>
        <div style={{ display: "grid", gap: "1rem" }}>
          <h1>Your school's assessment workspace</h1>
          <p>Sign in with the account your school or teacher set up for you. There is no public sign-up.</p>
        </div>
        <p style={{ fontSize: "var(--step--1)" }}>Having trouble signing in? Ask your school administrator.</p>
      </aside>

      <main className="signin-form" id="main">
        <h2 style={{ fontSize: "var(--step-2)" }}>Sign in</h2>
        <form onSubmit={onSubmit} noValidate={false}>
          <Field id="email" name="email" label="Email" type="email" autoComplete="username" required />
          <Field id="password" name="password" label="Password" type="password" autoComplete="current-password" required />
          {error && (
            <div className="note error" role="alert">
              <p>{error}</p>
            </div>
          )}
          <div className="btn-row">
            <button className="btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
