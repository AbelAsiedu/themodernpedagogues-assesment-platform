"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? "GET",
    credentials: "same-origin",
    headers: {
      "x-tmp-client": "web",
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? "Request failed", e?.details);
  }
  return json as T;
}

/** Send a file (multipart). The browser sets the content type, including the boundary. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method: "POST", credentials: "same-origin", headers: { "x-tmp-client": "web" }, body: form });
  const text = await res.text();
  let json: { error?: { code?: string; message?: string; details?: { path: string; message: string }[] } } | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* a proxy error page is not JSON */ }
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? (res.status === 413 ? "That file is too large." : "The upload failed"), e?.details);
  }
  return json as T;
}

/** Plain-language message for an error, including field-level validation problems. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details?.length) return err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(". ");
    if (err.status === 403) return "You don't have permission to do that.";
    return err.message;
  }
  return "Can't reach the server. Check your connection and try again.";
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);

  const load = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}
