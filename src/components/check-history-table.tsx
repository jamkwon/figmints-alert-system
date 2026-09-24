import { CheckStatusBadge } from "@/components/status";
import { EmptyState, When, table } from "@/components/ui";
import type { CheckResult, MonitorType } from "@/lib/types";

export function CheckHistoryTable({ checks, monitorType }: { checks: CheckResult[]; monitorType?: MonitorType }) {
  if (checks.length === 0) return <EmptyState>No checks have run yet.</EmptyState>;
  return (
    <div className={table.wrapper}>
      <table className={table.table}>
        <thead className={table.head}>
          <tr>
            <th className={table.th}>Result</th>
            <th className={table.th}>Checked</th>
            <th className={table.th}>HTTP</th>
            <th className={table.th}>Time</th>
            <th className={table.th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.id} className={table.row}>
              <td className={table.td}>
                <CheckStatusBadge status={check.status} monitorType={monitorType} />
              </td>
              <td className={table.td}>
                <When iso={check.checked_at} />
              </td>
              <td className={table.td}>{check.http_status ?? "—"}</td>
              <td className={`${table.td} whitespace-nowrap`}>
                {check.response_time_ms !== null ? `${check.response_time_ms} ms` : "—"}
              </td>
              <td className={`${table.td} text-xs text-red-700`}>{check.error_message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
