import Link from "next/link";
import { HealthBadge, HealthDot, IncidentStatusBadge, TeamLabel } from "@/components/status";
import { Panel, PageHeader, When, table } from "@/components/ui";
import { getAppData, type ClientView, type IncidentView } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { isActiveIncident, needsAttention, type Health } from "@/lib/health";
import type { Severity } from "@/lib/types";

const STAT_ACCENT: Partial<Record<Health, string>> = {
  critical: "border-t-fig-coral",
  warning: "border-t-amber-400",
  healthy: "border-t-fig-teal-light",
};

function StatCard({
  label,
  value,
  detail,
  health,
}: {
  label: string;
  value: number | string;
  detail?: string;
  health?: Health;
}) {
  const accent = (health && STAT_ACCENT[health]) ?? "border-t-fig-plum";
  return (
    <div className={`rounded-lg border border-t-4 border-slate-200 bg-white px-5 py-4 ${accent}`}>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        {health && <HealthDot health={health} />}
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-bold tracking-tight text-fig-ink">{value}</div>
      {detail && <div className="mt-0.5 text-xs text-slate-500">{detail}</div>}
    </div>
  );
}

function AttentionRows({ severity, incidents }: { severity: Severity; incidents: IncidentView[] }) {
  if (incidents.length === 0) return null;
  const heading = severity === "critical" ? "Critical" : "Warning";
  // Same colors as the severity badges
  const groupStyle =
    severity === "critical" ? "bg-fig-coral-wash text-red-800" : "bg-amber-100 text-amber-800";
  return (
    <>
      <tr>
        <td colSpan={6} className={`px-4 py-2 ${groupStyle}`}>
          <span className="flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
            <HealthDot health={severity} />
            {heading} ({incidents.length})
          </span>
        </td>
      </tr>
      {incidents.map(({ incident, client, monitor }) => (
        <tr key={incident.id} className={table.row}>
          <td className={table.td}>
            <Link href={`/clients/${client.id}`} className="font-semibold text-fig-plum hover:underline">
              {client.name}
            </Link>
            {monitor && <div className="text-xs text-slate-500">{monitor.name}</div>}
          </td>
          <td className={`${table.td} max-w-md`}>
            <div className="font-medium text-fig-ink">{incident.title}</div>
            {incident.description && <div className="mt-0.5 text-xs text-slate-600">{incident.description}</div>}
          </td>
          <td className={table.td}>
            <When iso={incident.first_detected_at} />
          </td>
          <td className={table.td}>
            <When iso={monitor?.last_checked_at ?? incident.last_detected_at} />
          </td>
          <td className={table.td}>
            <IncidentStatusBadge status={incident.status} />
          </td>
          <td className={table.td}>
            <TeamLabel team={incident.assigned_team} />
          </td>
        </tr>
      ))}
    </>
  );
}

function ClientChips({ clients }: { clients: ClientView[] }) {
  return (
    <ul className="flex flex-wrap gap-2 p-4">
      {clients.map(({ client, health }) => (
        <li key={client.id}>
          <Link
            href={`/clients/${client.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:border-fig-plum hover:text-fig-plum"
          >
            <HealthDot health={health} />
            {client.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const data = await getAppData();

  const attention = data.incidents.filter((i) => needsAttention(i.incident));
  const critical = attention.filter((i) => i.incident.severity === "critical");
  const warnings = attention.filter((i) => i.incident.severity === "warning");
  const openIncidents = data.incidents.filter((i) => isActiveIncident(i.incident));

  const activeClients = data.clients.filter((c) => c.client.active);
  const healthyClients = activeClients.filter((c) => c.health === "healthy");
  const otherClients = activeClients.filter((c) => !["critical", "warning", "healthy"].includes(c.health));

  const activeWebsites = activeClients.flatMap((c) => c.websites).filter((w) => w.website.active);
  const healthyWebsites = activeWebsites.filter((w) => w.health === "healthy");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="What needs attention right now."
        actions={<span className="text-xs text-slate-500">Updated {formatDateTime(data.loadedAt)}</span>}
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatCard label="Critical issues" value={critical.length} health="critical" />
        <StatCard label="Warnings" value={warnings.length} health="warning" />
        <StatCard
          label="Open incidents"
          value={openIncidents.length}
          detail={
            openIncidents.length > attention.length
              ? `${openIncidents.length - attention.length} snoozed or in maintenance`
              : undefined
          }
        />
        <StatCard
          label="Healthy websites"
          value={`${healthyWebsites.length} / ${activeWebsites.length}`}
          health="healthy"
        />
      </div>

      <Panel title="Needs attention" aside={`${attention.length} active`} className="mb-6">
        {attention.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-8 text-sm text-slate-600">
            <HealthBadge health="healthy" label="All clear" />
            No open critical or warning incidents.
          </div>
        ) : (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Client / Monitor</th>
                  <th className={table.th}>Problem</th>
                  <th className={table.th}>First detected</th>
                  <th className={table.th}>Last checked</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Team</th>
                </tr>
              </thead>
              <tbody>
                <AttentionRows severity="critical" incidents={critical} />
                <AttentionRows severity="warning" incidents={warnings} />
              </tbody>
            </table>
          </div>
        )}
        {attention.length > critical.length + warnings.length && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Plus {attention.length - critical.length - warnings.length} informational incident(s).{" "}
            <Link href="/incidents" className="text-fig-plum hover:underline">
              View all incidents
            </Link>
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-6">
        <Panel title={`Healthy clients (${healthyClients.length})`}>
          {healthyClients.length > 0 ? (
            <ClientChips clients={healthyClients} />
          ) : (
            <p className="px-4 py-6 text-sm text-slate-500">No clients are fully healthy right now.</p>
          )}
        </Panel>
        {otherClients.length > 0 && (
          <Panel title={`Maintenance, snoozed, or not yet checked (${otherClients.length})`}>
            <ClientChips clients={otherClients} />
          </Panel>
        )}
      </div>
    </>
  );
}
