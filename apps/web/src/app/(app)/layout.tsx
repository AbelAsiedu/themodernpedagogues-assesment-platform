"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { navFor } from "@/lib/nav";
import { ROLE_LABEL, useSession, type Me } from "@/lib/session";
import { Loading } from "@/components/ui";

function Nav({ me, pathname }: { me: Me; pathname: string }) {
  return (
    <nav className="nav" aria-label="Main">
      {navFor(me).map((item) => {
        const current = pathname === item.href || (item.href !== "/overview" && pathname.startsWith(item.href + "/"));
        return (
          <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Who({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const role = me.platformRole ?? me.institutions[0]?.role ?? "";
  return (
    <div className="who">
      <div>
        <strong>{me.user.fullName}</strong>
        {ROLE_LABEL[role] ?? "Member"}
      </div>
      <button className="btn small quiet" style={{ color: "#fff", borderColor: "rgba(255,255,255,.5)" }} onClick={onLogout}>
        Sign out
      </button>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state, router]);

  if (state.status !== "ready") {
    return (
      <div style={{ padding: "2rem" }}>
        <Loading label="Checking your session" />
      </div>
    );
  }
  const { me } = state;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="topbar">
        <Link className="brand" href="/overview">TMP Assessment</Link>
        <details>
          <summary>Menu</summary>
          <div className="menu">
            <Nav me={me} pathname={pathname} />
            <Who me={me} onLogout={() => void logout()} />
          </div>
        </details>
      </div>
      <div className="shell">
        <aside className="sidebar">
          <Link className="brand" href="/overview">
            TMP Assessment
            <small>The Modern Pedagogues</small>
          </Link>
          <Nav me={me} pathname={pathname} />
          <Who me={me} onLogout={() => void logout()} />
        </aside>
        <main className="main" id="main">
          <div className="page">{children}</div>
        </main>
      </div>
    </>
  );
}
