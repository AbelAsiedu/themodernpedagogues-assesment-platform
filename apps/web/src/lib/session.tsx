"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { INSTITUTION_ROLE_PERMISSIONS, isInstitutionRole, type Permission } from "@tmp/shared";
import { ApiError, api } from "./api";

export interface MeInstitution {
  institutionId: string;
  name: string;
  slug: string;
  role: string;
  status: string;
}
export interface Me {
  user: { id: string; email: string; fullName: string };
  platformRole: string | null;
  roles: string[];
  platformPermissions: Permission[];
  institutions: MeInstitution[];
}

type State = { status: "loading" } | { status: "anonymous" } | { status: "ready"; me: Me };

interface Ctx {
  state: State;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}
const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      setState({ status: "ready", me: await api<Me>("/auth/me") });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: "anonymous" });
      else throw e;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setState({ status: "anonymous" }));
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, refresh, logout }), [state, refresh, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/**
 * UI-only permission check, used to decide what to SHOW.
 * The API re-checks every request, so hiding a button is a convenience, never the protection.
 */
export function hasPerm(me: Me, permission: Permission, institutionId?: string): boolean {
  if (me.platformPermissions.includes(permission)) return true;
  if (!institutionId) return false;
  return me.institutions.some(
    (i) =>
      i.institutionId === institutionId &&
      i.status === "active" &&
      isInstitutionRole(i.role) &&
      INSTITUTION_ROLE_PERMISSIONS[i.role].includes(permission),
  );
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super administrator",
  platform_admin: "Platform administrator",
  academic_admin: "Academic administrator",
  institution_admin: "School administrator",
  teacher: "Teacher",
  student: "Student",
};
