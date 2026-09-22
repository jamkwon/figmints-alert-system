import type { Metadata } from "next";
import Link from "next/link";
import { HealthBadge } from "@/components/status";
import { EmptyState, Panel, PageHeader, When, table } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { displayUrl } from "@/lib/format";
import { needsAttention } from "@/lib/health";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { clients } = await getAppData();
  const activeCount = clients.filter((c) => c.client.active).length;

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${activeCount} active client${activeCount === 1 ? "" : "s"}, most urgent first.`}
      />
      <Panel>
        {clients.length === 0 ? (
          <EmptyState>No clients yet.</EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Client</th>
                  <th className={table.th}>Monitors</th>
                  <th className={table.th}>Open incidents</th>
                  <th className={table.th}>Last check</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(({ client, health, monitors, activeIncidents, lastCheckedAt }) => {
                  const activeMonitors = monitors.filter((m) => m.monitor.active);
                  const attention = activeIncidents.filter((i) => needsAttention(i.incident));
                  return (
                    <tr key={client.id} className={`${table.row} ${client.active ? "" : "opacity-60"}`}>
                      <td className={table.td}>
                        <HealthBadge health={health} />
                      </td>
                      <td className={table.td}>
                        <Link href={`/clients/${client.id}`} className="font-semibold text-fig-plum hover:underline">
                          {client.name}
                        </Link>
                        {client.primary_website && (
                          <div className="text-xs text-slate-500">{displayUrl(client.primary_website)}</div>
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
