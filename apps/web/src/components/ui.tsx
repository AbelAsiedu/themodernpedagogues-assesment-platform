"use client";
import type { ReactNode } from "react";
import { describeError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: "0.6rem" }}>
      <span className="sr-only">{label}…</span>
      <div className="skeleton" />
      <div className="skeleton" style={{ width: "70%" }} />
      <div className="skeleton" style={{ width: "45%" }} />
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="note error" role="alert">
      <p>{describeError(error)}</p>
      {retry && (
        <p style={{ marginTop: "0.5rem" }}>
          <button className="btn small quiet" onClick={retry}>Try again</button>
        </p>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Pill({ value }: { value: string }) {
  const tone: Record<string, string> = {
    active: "ok", live: "ok", success: "ok",
    pending: "wait", partial: "wait",
    suspended: "bad", deactivated: "bad", denied: "bad", failure: "bad",
    planned: "plain",
  };
  return <span className={`pill ${tone[value] ?? "plain"}`}>{value}</span>;
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

/** Marks-on-an-exam-paper rows: label, dotted leader, value. */
export function Leaders({ rows, asOf }: { rows: { label: string; value: number | string }[]; asOf?: string }) {
  return (
    <>
      <ul className="leaders">
        {rows.map((r) => (
          <li key={r.label}>
            <span>{r.label}</span>
            <span className="dots" aria-hidden="true" />
            <span className="value">{r.value}</span>
          </li>
        ))}
      </ul>
      {asOf && <p className="asof">As of {fmtDateTime(asOf)}</p>}
    </>
  );
}

export function Field({
  id, label, hint, ...input
}: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}
