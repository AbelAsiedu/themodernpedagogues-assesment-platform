"use client";
import { useEffect, useMemo, useState } from "react";
import type { Permission, QuestionType } from "@tmp/shared";
import { api } from "./api";
import { hasPerm, useSession } from "./session";

export interface Topic { id: string; subjectId: string; name: string }
export interface Subject { id: string; name: string; level: string; topics: Topic[] }
export interface McqContent { options: { id: string; text: string }[]; correctOptionId: string }
export interface Question {
  id: string; institutionId: string; subjectId: string; topicId: string | null;
  type: QuestionType; stem: string; explanation: string | null; difficulty: string; marks: number;
  content: Record<string, unknown>; status: string; source: "manual" | "ai" | "import"; version: number;
  createdBy: string | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  updatedAt: string;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", needs_review: "Needs review", approved: "Approved", rejected: "Rejected", archived: "Archived",
};

/** Schools the signed-in person can use for a feature. Platform staff see every school; others see their own. */
export function useSchools(permission: Permission) {
  const { state } = useSession();
  const me = state.status === "ready" ? state.me : null;
  const platform = !!me && me.platformRole !== null;
  const [all, setAll] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    if (!platform) return;
    let live = true;
    api<{ institutions: { id: string; name: string; status: string }[] }>("/institutions")
      .then((r) => live && setAll(r.institutions.filter((i) => i.status === "active").map((i) => ({ id: i.id, name: i.name }))))
      .catch(() => live && setAll([]));
    return () => { live = false; };
  }, [platform]);

  return useMemo(() => {
    if (!me) return { schools: [] as { id: string; name: string }[], loading: true };
    if (platform) {
      return { schools: (all ?? []).filter((s) => hasPerm(me, permission, s.id)), loading: all === null };
    }
    const mine = me.institutions
      .filter((i) => i.status === "active" && hasPerm(me, permission, i.institutionId))
      .map((i) => ({ id: i.institutionId, name: i.name }));
    return { schools: mine, loading: false };
  }, [me, platform, all, permission]);
}
