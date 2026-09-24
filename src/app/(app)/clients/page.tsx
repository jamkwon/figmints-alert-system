import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, FilterSelect, filterInputClass, param } from "@/components/filter-bar";
import { HealthBadge } from "@/components/status";
import { EmptyState, LinkButton, Panel, PageHeader, When, table } from "@/components/ui";
import { getAppData, type ClientView } from "@/lib/data";
import { displayUrl, formatUptime, isInFuture } from "@/lib/format";
import { needsAttention } from "@/lib/health";

export const metadata: Metadata = { title: "Clients" };

const HEALTH_FILTERS: { value: string; label: string; matches: (c: ClientView) => boolean }[] = [
  { value: "attention", label: "Needs attention", matches: (c) => c.health === "critical" || c.health === "warning" },
  { value: "healthy", label: "Healthy", matches: (c) => c.health === "healthy" },
  {
    value: "other",
    label: "Maintenance / no data",
    matches: (c) => c.health === "informational" || c.health === "unknown",
  },
  { value: "inactive", label: "Inactive", matches: (c) => c.health === "inactive" },
];

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const sp = await searchParams;
  const q = param(sp.q);
  const health = param(sp.health);
  const { clients } = await getAppData();
  const activeCount = clients.filter((c) => c.client.active).length;

  const healthFilter = HEALTH_FILTERS.find((f) => f.value === health);
  const shown = clients.filter(
    (c) =>
      (!q || c.client.name.toLowerCase().includes(q.toLowerCase()) || c.client.primary_website?.includes(q.toLowerCase())) &&
      (!healthFilter || healthFilter.matches(c)),
  );

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${activeCount} active client${activeCount === 1 ? "" : "s"}, most urgent first.`}
        actions={
          <LinkButton href="/clients/new" primary>
            Add client
          </LinkButton>
        }
      />
      <FilterBar action="/clients" active={Boolean(q || health)}>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Search
          <input name="q" defaultValue={q} placeholder="Client name or website" className={`${filterInputClass} w-64`} />
        </label>
        <FilterSelect name="health" label="Health" value={health} options={HEALTH_FILTERS} />
      </FilterBar>
      <Panel>
        {shown.length === 0 ? (
          <EmptyState>{clients.length === 0 ? "No clients yet." : "No clients match these filters."}</EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Client</th>
                  <th className={table.th}>Monitors</th>
                  <th className={table.th}>Open incidents</th>
                  <th className={table.th}>Uptime (7 days)</th>
                  <th className={table.th}>Last check</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ client, health: clientHealth, monitors, activeIncidents, lastCheckedAt, uptime7d, websites }) => {
                  const activeMonitors = monitors.filter((m) => m.monitor.active);
                  const attention = activeIncidents.filter((i) => needsAttention(i.incident));
                  const inMaintenance = websites.some((w) => isInFuture(w.website.maintenance_until));
                  return (
                    <tr key={client.id} className={`${table.row} ${client.active ? "" : "opacity-60"}`}>
                      <td className={table.td}>
                        <HealthBadge health={clientHealth} />
                      </td>
                      <td className={table.td}>
                        <Link href={`/clients/${client.id}`} className="font-semibold text-fig-plum hover:underline">
                          {client.name}
                        </Link>
                        {client.primary_website && (
                          <div className="text-xs text-slate-500">{displayUrl(client.primary_website)}</div>
                        )}
                        {inMaintenance && (
                          <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                            In maintenance
                          </span>
                        )}
                      </td>
                      <td className={table.td}>
                        {activeMonitors.length}
                        {monitors.length > activeMonitors.length && (
                          <span className="text-xs text-slate-500"> ({monitors.length - activeMonitors.length} paused)</span>
                        )}
                      </td>
                      <td className={table.td}>
                        {activeIncidents.length === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : (
                          <>
                            <span className="font-medium">{activeIncidents.length}</span>
                            {attention.length < activeIncidents.length && (
                              <span className="text-xs text-slate-500">
                                {" "}
                                ({activeIncidents.length - attention.length} snoozed/maintenance)
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className={table.td}>
                        {formatUptime(uptime7d.passed, uptime7d.checks) ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className={table.td}>
                        <When iso={lastCheckedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
