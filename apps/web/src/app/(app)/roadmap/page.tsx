"use client";
import { ROADMAP } from "@/lib/roadmap";
import { PageHead, Pill } from "@/components/ui";

export default function RoadmapPage() {
  return (
    <>
      <PageHead title="Roadmap">What works today and what doesn't. A module only says "live" once it is built, connected to the API and tested.</PageHead>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Build status by module</caption>
          <thead><tr><th scope="col">Phase</th><th scope="col">Module</th><th scope="col">Status</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            {ROADMAP.map((m) => (
              <tr key={m.name}>
                <td>{m.phase}</td><td>{m.name}</td><td><Pill value={m.status} /></td><td>{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
