"use client";
import { useEffect, useState } from "react";
import type { Permission } from "@tmp/shared";
import { useSchools } from "@/lib/questions";

/** Chooses which school's data to work with. Hidden when there is only one. */
export function useSchoolChoice(permission: Permission) {
  const { schools, loading } = useSchools(permission);
  const [chosen, setChosen] = useState<string>("");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("tmp.school");
      if (saved && schools.some((s) => s.id === saved)) { setChosen(saved); return; }
    } catch { /* storage unavailable: fine */ }
    if (!schools.some((s) => s.id === chosen)) setChosen(schools[0]?.id ?? "");
  }, [schools, chosen]);
  const choose = (id: string) => {
    setChosen(id);
    try { sessionStorage.setItem("tmp.school", id); } catch { /* ignore */ }
  };
  return { schools, loading, schoolId: chosen, choose };
}

export function SchoolPicker({ schools, value, onChange }: { schools: { id: string; name: string }[]; value: string; onChange(id: string): void }) {
  if (schools.length <= 1) return null;
  return (
    <div className="field" style={{ maxWidth: "22rem" }}>
      <label htmlFor="school-pick">School</label>
      <select id="school-pick" value={value} onChange={(e) => onChange(e.target.value)}>
        {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}
