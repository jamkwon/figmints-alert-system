import Link from "next/link";
import { RunCheckButton } from "@/components/run-check-button";
import { HealthBadge } from "@/components/status";
import { EmptyState, When, table } from "@/components/ui";
import { getDataSource, type MonitorView } from "@/lib/data";
import { displayUrl, formatUptime } from "@/lib/format";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS, formatInterval } from "@/lib/labels";

function LastResult({ view }: { view: MonitorView }) {
  const s = view.summary;
  if (!s?.last_status) return <span className="text-slate-400">No checks yet</span>;
  return (
    <div className="text-xs text-slate-600">
      {s.last_http_status !== null && <span>HTTP {s.last_http_status}</span>}
      {s.last_response_time_ms !== null && <span> · {s.last_response_time_ms} ms</span>}
      {s.last_error_message && <div className="mt-0.5 text-red-700">{s.last_error_message}</div>}
    </div>
  );
}

export function MonitorTable({
  monitors,
  showClient = true,
}: {
  monitors: MonitorView[];
  showClient?: boolean;
}) {
  if (monitors.length === 0) return <EmptyState>No monitors configured.</EmptyState>;
  const sampleMode = getDataSource() === "sample";

  return (
    <div className={table.wrapper}>
      <table className={table.table}>
        <thead className={table.head}>
          <tr>
            <th className={table.th}>Status</th>
            <th className={table.th}>Monitor</th>
            {showClient && <th className={table.th}>Client</th>}
            <th className={table.th}>Type</th>
            <th className={table.th}>Last result</th>
            <th className={table.th}>Last checked</th>
            <th className={table.th}>Last successful</th>
            <th className={table.th}>Uptime 7d</th>
            <th className={table.th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {monitors.map((view) => {
            const { monitor, website, client } = view;
            return (
              <tr key={monitor.id} className={table.row}>
                <td className={table.td}>
                  <HealthBadge health={view.health} />
                </td>
                <td className={table.td}>
                  <Link href={`/monitors/${monitor.id}`} className="block font-medium text-fig-ink hover:text-fig-plum hover:underline">
                    {monitor.name}
                  </Link>
                  <a
                    href={monitor.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-500 hover:text-fig-plum hover:underline"
                  >
                    {displayUrl(monitor.target_url)}
                  </a>
                  {website.environment !== "production" && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                      {ENVIRONMENT_LABELS[website.environment]}
                    </span>
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
                  <div>{MONITOR_TYPE_LABELS[monitor.monitor_type]}</div>
                  <div className="text-xs text-slate-500">
                    {formatInterval(monitor.interval_minutes)}
                    {monitor.expected_text && <> · expects “{monitor.expected_text}”</>}
                    {monitor.max_response_time_ms !== null && <> · max {monitor.max_response_time_ms} ms</>}
                  </div>
                </td>
                <td className={`${table.td} max-w-xs`}>
                  <LastResult view={view} />
                </td>
                <td className={table.td}>
                  <When iso={monitor.last_checked_at} />
                </td>
                <td className={table.td}>
                  <When iso={view.summary?.last_success_at} />
                </td>
                <td className={`${table.td} whitespace-nowrap`}>
                  {formatUptime(view.uptime?.passed_7d ?? 0, view.uptime?.checks_7d ?? 0) ?? (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className={`${table.td} text-right`}>
                  <RunCheckButton
                    monitorId={monitor.id}
                    compact
                    disabledReason={
                      sampleMode
                        ? "Connect Supabase to run real checks"
                        : view.health === "inactive"
                          ? "This monitor is paused"
                          : undefined
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
