import Link from "next/link";
import { IncidentStatusBadge, SeverityBadge, TeamLabel } from "@/components/status";
import { EmptyState, When, table } from "@/components/ui";
import type { IncidentView } from "@/lib/data";
import { formatDateTime, formatDuration } from "@/lib/format";

export function IncidentTable({
  incidents,
  showClient = true,
  emptyMessage = "No incidents.",
}: {
  incidents: IncidentView[];
  showClient?: boolean;
  emptyMessage?: string;
}) {
  if (incidents.length === 0) return <EmptyState>{emptyMessage}</EmptyState>;

  return (
    <div className={table.wrapper}>
      <table className={table.table}>
        <thead className={table.head}>
          <tr>
            <th className={table.th}>Severity</th>
            <th className={table.th}>Problem</th>
            {showClient && <th className={table.th}>Client</th>}
            <th className={table.th}>Status</th>
            <th className={table.th}>Team</th>
            <th className={table.th}>First detected</th>
            <th className={table.th}>Last detected</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map(({ incident, client, monitor }) => (
            <tr key={incident.id} className={table.row}>
              <td className={table.td}>
                <SeverityBadge severity={incident.severity} />
              </td>
              <td className={`${table.td} max-w-md`}>
                <Link href={`/incidents/${incident.id}`} className="font-medium text-fig-ink hover:text-fig-plum hover:underline">
                  {incident.title}
                </Link>
                {monitor && (
                  <div className="text-xs text-slate-500">
                    Monitor:{" "}
                    <Link href={`/monitors/${monitor.id}`} className="hover:text-fig-plum hover:underline">
                      {monitor.name}
                    </Link>
                  </div>
                )}
                {incident.description && (
                  <div className="mt-1 text-xs text-slate-600">{incident.description}</div>
                )}
                {incident.internal_notes && (
                  <div className="mt-1 text-xs text-slate-500 italic">Note: {incident.internal_notes}</div>
                )}
              </td>
              {showClient && (
                <td className={table.td}>
                  <Link href={`/clients/${client.id}`} className="font-medium text-fig-plum hover:underline">
                    {client.name}
                  </Link>
                </td>
              )}
              <td className={table.td}>
                <IncidentStatusBadge status={incident.status} />
                {incident.resolved_at && (
                  <div className="mt-1 text-xs whitespace-nowrap text-slate-500">
                    after {formatDuration(incident.first_detected_at, incident.resolved_at)}
                  </div>
                )}
                {incident.status === "snoozed" && incident.snoozed_until && (
                  <div className="mt-1 text-xs whitespace-nowrap text-slate-500">
                    until {formatDateTime(incident.snoozed_until)}
                  </div>
                )}
              </td>
              <td className={table.td}>
                <TeamLabel team={incident.assigned_team} />
              </td>
              <td className={table.td}>
                <When iso={incident.first_detected_at} />
              </td>
              <td className={table.td}>
                <When iso={incident.resolved_at ?? incident.last_detected_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
