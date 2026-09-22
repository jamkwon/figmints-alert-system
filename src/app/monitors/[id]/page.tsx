import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RunCheckButton } from "@/components/run-check-button";
import { CheckStatusBadge, HealthBadge, IncidentStatusBadge, SeverityBadge } from "@/components/status";
import { EmptyState, Panel, PageHeader, When, table } from "@/components/ui";
import { getAppData, getCheckHistory, type MonitorView } from "@/lib/data";
import { displayUrl, formatDateTime, timeAgo } from "@/lib/format";
import { failingSince } from "@/lib/health";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS, SEVERITY_LABELS, formatInterval } from "@/lib/labels";
import { DEFAULT_MAX_RESPONSE_TIME_MS } from "@/lib/monitoring/evaluate";

const HISTORY_LIMIT = 50;

async function findMonitor(id: string): Promise<MonitorView | undefined> {
  const { monitors } = await getAppData();
  return monitors.find((m) => m.monitor.id === id);
}

export async function generateMetadata({ params }: PageProps<"/monitors/[id]">): Promise<Metadata> {
  const view = await findMonitor((await params).id);
  return { title: view ? `${view.monitor.name} · ${view.client.name}` : "Monitor not found" };
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="break-words text-fig-ink">{children}</dd>
    </div>
  );
}

export default async function MonitorDetailPage({ params }: PageProps<"/monitors/[id]">) {
  const view = await findMonitor((await params).id);
  if (!view) notFound();

  const { monitor, website, client, summary, health, activeIncident } = view;
  const [history, data] = await Promise.all([getCheckHistory(monitor.id, HISTORY_LIMIT), getAppData()]);
  const since = failingSince(history);

  let disabledReason: string | undefined;
  if (data.source === "sample") disabledReason = "Connect Supabase to run real checks";
  else if (health === "inactive") disabledReason = "This monitor is paused";

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/clients/${client.id}`} className="text-slate-500 hover:text-fig-plum">
          ← {client.name}
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {monitor.name}
            <HealthBadge health={health} />
          </span>
        }
        description={
          <a href={monitor.target_url} target="_blank" rel="noopener noreferrer" className="text-fig-plum hover:underline">
            {displayUrl(monitor.target_url)} ↗
          </a>
        }
        actions={<RunCheckButton monitorId={monitor.id} disabledReason={disabledReason} />}
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label="Latest result">
          {summary?.last_status ? (
            <>
              <CheckStatusBadge status={summary.last_status} />
              <div className="mt-1 text-xs text-slate-600">
                {summary.last_http_status !== null && `HTTP ${summary.last_http_status}`}
                {summary.last_response_time_ms !== null && ` · ${summary.last_response_time_ms} ms`}
              </div>
              {summary.last_error_message && (
                <div className="mt-0.5 text-xs text-red-700">{summary.last_error_message}</div>
              )}
            </>
          ) : (
            <span className="text-slate-400">No checks yet</span>
          )}
        </Stat>
        <Stat label="Last checked">
          <When iso={monitor.last_checked_at} />
        </Stat>
        <Stat label="Last successful check">
          <When iso={summary?.last_success_at} />
        </Stat>
        <Stat label={since ? "Failing since" : "Active incident"}>
          {since ? (
            <When iso={since} />
          ) : activeIncident ? (
            <span className="font-medium">{activeIncident.title}</span>
          ) : (
            <span className="text-slate-400">None</span>
          )}
        </Stat>
      </div>

      {activeIncident && (
        <Panel title="Active incident" className="mb-6">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <SeverityBadge severity={activeIncident.severity} />
            <IncidentStatusBadge status={activeIncident.status} />
            <span className="font-medium">{activeIncident.title}</span>
            <span className="text-slate-500">
              First detected {formatDateTime(activeIncident.first_detected_at)} ({timeAgo(activeIncident.first_detected_at)})
            </span>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-[2fr_1fr] items-start gap-6">
        <Panel title="Recent checks" aside={`Latest ${Math.min(history.length, HISTORY_LIMIT)}`}>
          {history.length === 0 ? (
            <EmptyState>No checks have run yet.</EmptyState>
          ) : (
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
                  {history.map((check) => (
                    <tr key={check.id} className={table.row}>
                      <td className={table.td}>
                        <CheckStatusBadge status={check.status} />
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
          )}
        </Panel>

        <Panel title="Configuration">
          <dl>
            <ConfigRow label="Type">{MONITOR_TYPE_LABELS[monitor.monitor_type]}</ConfigRow>
            <ConfigRow label="Website">
              {displayUrl(website.url)} · {ENVIRONMENT_LABELS[website.environment]}
            </ConfigRow>
            <ConfigRow label="Expected status">
              {monitor.expected_status_code ?? <span className="text-slate-500">200–399 (default)</span>}
            </ConfigRow>
            <ConfigRow label="Expected text">
              {monitor.expected_text ? `“${monitor.expected_text}”` : <span className="text-slate-500">None</span>}
            </ConfigRow>
            {monitor.monitor_type === "response_time" && (
              <ConfigRow label="Max response time">
                {monitor.max_response_time_ms ?? `${DEFAULT_MAX_RESPONSE_TIME_MS} (default)`} ms
              </ConfigRow>
            )}
            <ConfigRow label="Interval">{formatInterval(monitor.interval_minutes)}</ConfigRow>
            <ConfigRow label="Severity on failure">{SEVERITY_LABELS[monitor.severity_on_failure]}</ConfigRow>
            <ConfigRow label="Active">{monitor.active ? "Yes" : "No (paused)"}</ConfigRow>
          </dl>
        </Panel>
      </div>
    </>
  );
}
