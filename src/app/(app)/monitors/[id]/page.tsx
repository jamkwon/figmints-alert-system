import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckHistoryTable } from "@/components/check-history-table";
import { RunCheckButton } from "@/components/run-check-button";
import { CheckStatusBadge, HealthBadge, IncidentStatusBadge, SeverityBadge } from "@/components/status";
import { LinkButton, Panel, PageHeader, When } from "@/components/ui";
import { getAppData, getCheckHistory, type MonitorView } from "@/lib/data";
import {
  certificateInfo,
  displayUrl,
  linkScanInfo,
  trackingInfo,
  formatDate,
  formatDateTime,
  formatUptime,
  isInFuture,
  timeAgo,
} from "@/lib/format";
import { failingSince } from "@/lib/health";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS, SEVERITY_LABELS, formatInterval } from "@/lib/labels";
import { DEFAULT_MAX_RESPONSE_TIME_MS, SSL_FAILURE_DAYS, SSL_WARNING_DAYS } from "@/lib/monitoring/evaluate";
import { TRACKING_TAGS, TRACKING_TAG_KEYS } from "@/lib/monitoring/tracking";

// Run check can start a broken link scan, which takes up to ~40 seconds.
export const maxDuration = 60;

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

  const { monitor, website, client, summary, health, activeIncident, uptime } = view;
  const isSsl = monitor.monitor_type === "ssl_expiry";
  const isLinkScan = monitor.monitor_type === "broken_links";
  const isTracking = monitor.monitor_type === "tracking_tags";
  const tags = isTracking ? trackingInfo(summary?.last_metadata) : null;
  const cert = isSsl ? certificateInfo(summary?.last_metadata) : null;
  const scan = isLinkScan ? linkScanInfo(summary?.last_metadata) : null;
  const uptimeRows = [
    { label: "Last 24 hours", passed: uptime?.passed_24h ?? 0, checks: uptime?.checks_24h ?? 0 },
    { label: "Last 7 days", passed: uptime?.passed_7d ?? 0, checks: uptime?.checks_7d ?? 0 },
    { label: "Last 30 days", passed: uptime?.passed_30d ?? 0, checks: uptime?.checks_30d ?? 0 },
  ];
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
        actions={
          <>
            <LinkButton href={`/monitors/${monitor.id}/edit`}>Edit monitor</LinkButton>
            <RunCheckButton monitorId={monitor.id} disabledReason={disabledReason} />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label="Latest result">
          {summary?.last_status ? (
            <>
              <CheckStatusBadge status={summary.last_status} monitorType={monitor.monitor_type} />
              <div className="mt-1 text-xs text-slate-600">
                {[
                  summary.last_http_status !== null ? `HTTP ${summary.last_http_status}` : null,
                  summary.last_response_time_ms !== null ? `${summary.last_response_time_ms} ms` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
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
            <Link href={`/incidents/${activeIncident.id}`} className="font-medium text-fig-plum hover:underline">
              {activeIncident.title}
            </Link>
            <span className="text-slate-500">
              First detected {formatDateTime(activeIncident.first_detected_at)} ({timeAgo(activeIncident.first_detected_at)})
            </span>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-[2fr_1fr] items-start gap-6">
        <Panel title="Recent checks" aside={`Latest ${Math.min(history.length, HISTORY_LIMIT)}`}>
          <CheckHistoryTable checks={history} monitorType={monitor.monitor_type} />
        </Panel>

        <div className="space-y-6">
          {isTracking ? (
            <Panel title="Tracking tags" aside={<Link href={`/monitors/${monitor.id}/edit`} className="text-fig-plum hover:underline">Choose tags</Link>}>
              <ul className="divide-y divide-slate-100">
                {TRACKING_TAG_KEYS.filter((t) => monitor.expected_tags.includes(t) || tags?.found[t]).map((t) => {
                  const expected = monitor.expected_tags.includes(t);
                  const ids = tags?.found[t];
                  return (
                    <li key={t} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                      <div>
                        <div className="font-medium text-fig-ink">{TRACKING_TAGS[t].label}</div>
                        <div className="text-xs text-slate-500">
                          {ids ? (ids.length ? ids.join(", ") : "Found (no ID shown)") : "Not on the page"}
                          {!expected && " · found, not expected"}
                        </div>
                      </div>
                      {expected && (
                        <HealthBadge
                          health={!tags ? "unknown" : ids ? "healthy" : "critical"}
                          label={!tags ? "Not checked" : ids ? "Present" : "Missing"}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              {monitor.expected_tags.length === 0 && (
                <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                  No tags are expected yet, so this check always passes. Choose the tags this page must have.
                </p>
              )}
            </Panel>
          ) : isLinkScan ? (
            <Panel title="Broken links" aside={scan ? `${scan.checked} of ${scan.found} checked` : undefined}>
              {!scan ? (
                <p className="px-4 py-4 text-sm text-slate-500">Not scanned yet.</p>
              ) : scan.broken.length === 0 ? (
                <p className="px-4 py-4 text-sm text-fig-teal">No broken links found in the last scan.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {scan.broken.map((b) => (
                    <li key={b.url} className="px-4 py-2.5 text-sm">
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="break-all text-fig-plum hover:underline">
                        {b.url.replace(/^https?:\/\//, "")}
                      </a>
                      <div className="text-xs text-slate-500">
                        <span className="text-red-700">{b.reason}</span> · {b.kind}
                        {b.text && <> · &ldquo;{b.text}&rdquo;</>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {scan && scan.unverified > 0 && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  {scan.unverified} link{scan.unverified === 1 ? "" : "s"} couldn&apos;t be verified (blocked, rate-limited or
                  slow). Those aren&apos;t counted as broken.
                </p>
              )}
            </Panel>
          ) : isSsl ? (
            <Panel title="Certificate">
              <dl>
                <ConfigRow label="Expires">
                  {cert ? (
                    <>
                      <span className="font-semibold">{formatDate(cert.validTo)}</span>
                      {cert.daysLeft !== null && (
                        <span className="text-xs text-slate-500">
                          {" "}
                          ({cert.daysLeft >= 0 ? `${cert.daysLeft} days left` : "expired"})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-500">Not checked yet</span>
                  )}
                </ConfigRow>
                <ConfigRow label="Issued by">{cert?.issuer ?? <span className="text-slate-500">Unknown</span>}</ConfigRow>
                <ConfigRow label="Warns at">
                  {SSL_WARNING_DAYS} days left{" "}
                  <span className="text-xs text-slate-500">(fails at {SSL_FAILURE_DAYS} days, expired or untrusted)</span>
                </ConfigRow>
              </dl>
            </Panel>
          ) : (
          <Panel title="Uptime">
            <dl>
              {uptimeRows.map((row) => (
                <ConfigRow key={row.label} label={row.label}>
                  <span className="font-semibold">{formatUptime(row.passed, row.checks) ?? "—"}</span>{" "}
                  <span className="text-xs text-slate-500">
                    {row.checks > 0 ? `${row.passed} of ${row.checks} checks passed` : "no checks"}
                  </span>
                </ConfigRow>
              ))}
            </dl>
          </Panel>
          )}

          <Panel title="Configuration">
            <dl>
              <ConfigRow label="Type">{MONITOR_TYPE_LABELS[monitor.monitor_type]}</ConfigRow>
              <ConfigRow label="Website">
                {displayUrl(website.url)} · {ENVIRONMENT_LABELS[website.environment]}
              </ConfigRow>
              {!isSsl && !isLinkScan && !isTracking && (
                <>
                  <ConfigRow label="Expected status">
                    {monitor.expected_status_code ?? <span className="text-slate-500">200–399 (default)</span>}
                  </ConfigRow>
                  <ConfigRow label="Expected text">
                    {monitor.expected_text ? `“${monitor.expected_text}”` : <span className="text-slate-500">None</span>}
                  </ConfigRow>
                </>
              )}
              {monitor.monitor_type === "response_time" && (
                <ConfigRow label="Max response time">
                  {monitor.max_response_time_ms ?? `${DEFAULT_MAX_RESPONSE_TIME_MS} (default)`} ms
                </ConfigRow>
              )}
              <ConfigRow label="Interval">{formatInterval(monitor.interval_minutes)}</ConfigRow>
              <ConfigRow label="Next check">
                {!monitor.active ? (
                  <span className="text-slate-500">Paused</span>
                ) : isInFuture(monitor.next_check_at) ? (
                  <When iso={monitor.next_check_at} />
                ) : (
                  <span className="text-slate-500">Due now (next scheduler run)</span>
                )}
              </ConfigRow>
              <ConfigRow label="Severity on failure">{SEVERITY_LABELS[monitor.severity_on_failure]}</ConfigRow>
              <ConfigRow label="Active">{monitor.active ? "Yes" : "No (paused)"}</ConfigRow>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
