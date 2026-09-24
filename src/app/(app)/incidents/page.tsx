import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, FilterSelect, param } from "@/components/filter-bar";
import { IncidentTable } from "@/components/incident-table";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { isActiveIncident } from "@/lib/health";
import { SEVERITIES, SEVERITY_LABELS, TEAM_LABELS } from "@/lib/labels";
import type { AssignedTeam } from "@/lib/types";

export const metadata: Metadata = { title: "Incidents" };

const VIEWS = {
  active: { label: "Active", empty: "No active incidents." },
  closed: { label: "Resolved & ignored", empty: "No resolved or ignored incidents." },
  all: { label: "All", empty: "No incidents recorded yet." },
} as const;

type View = keyof typeof VIEWS;

export default async function IncidentsPage({ searchParams }: PageProps<"/incidents">) {
  const sp = await searchParams;
  const requested = param(sp.view);
  const view: View = requested && requested in VIEWS ? (requested as View) : "active";
  const filters = { client: param(sp.client), severity: param(sp.severity), team: param(sp.team) };

  const { incidents, clients } = await getAppData();
  const filtered = incidents.filter(
    ({ incident }) =>
      (!filters.client || incident.client_id === filters.client) &&
      (!filters.severity || incident.severity === filters.severity) &&
      (!filters.team || incident.assigned_team === filters.team),
  );
  const inView = (v: View) =>
    filtered.filter((i) => (v === "all" ? true : isActiveIncident(i.incident) === (v === "active")));
  const shown = inView(view);
  const filtering = Boolean(filters.client || filters.severity || filters.team);

  // Tabs keep the current filters.
  const tabHref = (key: View) => {
    const params = new URLSearchParams(
      Object.entries({ ...filters, view: key === "active" ? undefined : key }).filter(
        (e): e is [string, string] => Boolean(e[1]),
      ),
    ).toString();
    return params ? `/incidents?${params}` : "/incidents";
  };

  return (
    <>
      <PageHeader title="Incidents" description="Problems confirmed by repeated failed checks." />
      <FilterBar action="/incidents" keep={{ view: view === "active" ? undefined : view }} active={filtering}>
        <FilterSelect
          name="client"
          label="Client"
          value={filters.client}
          options={clients.map((c) => ({ value: c.client.id, label: c.client.name }))}
        />
        <FilterSelect
          name="severity"
          label="Severity"
          value={filters.severity}
          options={SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] }))}
        />
        <FilterSelect
          name="team"
          label="Team"
          value={filters.team}
          options={(Object.keys(TEAM_LABELS) as AssignedTeam[]).map((t) => ({ value: t, label: TEAM_LABELS[t] }))}
        />
      </FilterBar>
      <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label="Incident views">
        {(Object.keys(VIEWS) as View[]).map((key) => (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={key === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              key === view
                ? "border-fig-plum font-semibold text-fig-plum"
                : "border-transparent text-slate-600 hover:text-fig-ink"
            }`}
          >
            {VIEWS[key].label} <span className="text-xs text-slate-400">({inView(key).length})</span>
          </Link>
        ))}
      </nav>
      <Panel>
        <IncidentTable
          incidents={shown}
          emptyMessage={filtering ? "No incidents match these filters." : VIEWS[view].empty}
        />
      </Panel>
    </>
  );
}
