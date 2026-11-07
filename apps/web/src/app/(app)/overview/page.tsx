"use client";
import Link from "next/link";
import { hasPerm, useSession, type Me, type MeInstitution } from "@/lib/session";
import { useApi } from "@/lib/api";
import { Empty, ErrorNote, Leaders, Loading, PageHead } from "@/components/ui";

interface PlatformOverview {
  users: { total: number };
  students: number;
  teachers: number;
  institutions: { total: number; byStatus: Record<string, number> };
  classes: number;
  usersWithActiveSession: number;
  asOf: string;
}
interface InstitutionOverview { teachers: number; students: number; administrators: number; classes: number; asOf: string }

function PlatformView() {
  const { data, error, loading, reload } = useApi<PlatformOverview>("/admin/overview");
  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} retry={reload} />;
  if (!data) return null;
  const pending = data.institutions.byStatus.pending ?? 0;
  return (
    <>
      <Leaders
        asOf={data.asOf}
        rows={[
          { label: "Users", value: data.users.total },
          { label: "Teachers", value: data.teachers },
          { label: "Students", value: data.students },
          { label: "Institutions", value: data.institutions.total },
          { label: "Awaiting approval", value: pending },
          { label: "Classes", value: data.classes },
          { label: "People with an open session", value: data.usersWithActiveSession },
        ]}
      />
      {pending > 0 && (
        <p>
          {pending} {pending === 1 ? "institution is" : "institutions are"} waiting for approval. <Link href="/institutions">Review institutions</Link>
        </p>
      )}
    </>
  );
}

function InstitutionView({ inst }: { inst: MeInstitution }) {
  const { data, error, loading, reload } = useApi<InstitutionOverview>(`/institutions/${inst.institutionId}/overview`);
  return (
    <section className="section" aria-labelledby={`h-${inst.institutionId}`}>
      <div className="section-head">
        <h2 id={`h-${inst.institutionId}`}>{inst.name}</h2>
        <Link href={`/institutions/${inst.institutionId}`}>Open school</Link>
      </div>
      {loading ? <Loading /> : error ? <ErrorNote error={error} retry={reload} /> : data && (
        <Leaders
          asOf={data.asOf}
          rows={[
            { label: "Teachers", value: data.teachers },
            { label: "Students", value: data.students },
            { label: "Classes", value: data.classes },
          ]}
        />
      )}
    </section>
  );
}

function StudentView({ institutions }: { institutions: MeInstitution[] }) {
  return (
    <>
      {institutions.map((i) => (
        <section className="section" key={i.institutionId}>
          <h2>{i.name}</h2>
          <p><Link href={`/institutions/${i.institutionId}`}>See your classes</Link></p>
        </section>
      ))}
    </>
  );
}

function body(me: Me) {
  if (hasPerm(me, "users.read")) return <PlatformView />;
  const active = me.institutions.filter((i) => i.status === "active");
  if (!active.length) {
    return (
      <Empty title="You're not part of a school yet">
        Your account is active but isn't linked to an active school. Ask your administrator to add you.
      </Empty>
    );
  }
  const staff = active.filter((i) => hasPerm(me, "members.read", i.institutionId));
  if (staff.length) return <>{staff.map((i) => <InstitutionView key={i.institutionId} inst={i} />)}</>;
  return <StudentView institutions={active} />;
}

export default function OverviewPage() {
  const { state } = useSession();
  if (state.status !== "ready") return null;
  const { me } = state;
  return (
    <>
      <PageHead title={`Welcome, ${me.user.fullName.split(" ")[0]}`}>
        Quizzes, exams and marking are still being built. This page shows what is live today.
      </PageHead>
      {body(me)}
    </>
  );
}
