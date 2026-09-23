import type { Metadata } from "next";
import Link from "next/link";
import { IncidentTable } from "@/components/incident-table";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { isActiveIncident } from "@/lib/health";

export const metadata: Metadata = { title: "Incidents" };

const VIEWS = {
  active: { label: "Active", empty: "No active incidents." },
  closed: { label: "Resolved & ignored", empty: "No resolved or ignored incidents." },
  all: { label: "All", empty: "No incidents recorded yet." },
} as const;

type View = keyof typeof VIEWS;

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const requested = (await searchParams).view;
  const view: View = typeof requested === "string" && requested in VIEWS ? (requested as View) : "active";

  const { incidents } = await getAppData();
  const counts: Record<View, number> = {
    active: incidents.filter((i) => isActiveIncident(i.incident)).length,
    closed: incidents.filter((i) => !isActiveIncident(i.incident)).length,
    all: incidents.length,
  };
  const shown = incidents.filter((i) =>
    view === "all" ? true : isActiveIncident(i.incident) === (view === "active"),
  );

  return (
    <>
      <PageHeader title="Incidents" description="Problems confirmed by repeated failed checks." />
      <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label="Incident views">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <Link
            key={key}
            href={key === "active" ? "/incidents" : `/incidents?view=${key}`}
            aria-current={key === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              key === view
                ? "border-fig-plum font-semibold text-fig-plum"
                : "border-transparent text-slate-600 hover:text-fig-ink"
            }`}
          >
            {VIEWS[key].label} <span className="text-xs text-slate-400">({counts[key]})</span>
          </Link>
        ))}
      </nav>
      <Panel>
        <IncidentTable incidents={shown} emptyMessage={VIEWS[view].empty} />
      </Panel>
    </>
  );
}
