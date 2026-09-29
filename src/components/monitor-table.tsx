import Link from "next/link";
import { RunCheckButton } from "@/components/run-check-button";
import { HealthBadge } from "@/components/status";
import { EmptyState, When, table } from "@/components/ui";
import { getDataSource, type MonitorView } from "@/lib/data";
import {
  certificateInfo,
  displayUrl,
  formatDate,
  formatUptime,
  linkScanInfo,
  timeAgo,
  trackingInfo,
  visibilityInfo,
  domainExpiryInfo,
  pageSpeedInfo,
  formatSeconds,
  contactFormInfo,
  wordpressInfo,
} from "@/lib/format";
import { compareVersions } from "@/lib/monitoring/wordpress";
import { TRACKING_TAGS, isTrackingTag } from "@/lib/monitoring/tracking";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS, countsTowardUptime, formatInterval } from "@/lib/labels";

function LastResult({ view }: { view: MonitorView }) {
  const s = view.summary;
  if (!s?.last_status) return <span className="text-slate-400">No checks yet</span>;
  const vis = view.monitor.monitor_type === "search_visibility" ? visibilityInfo(s.last_metadata) : null;
  if (vis) {
    return (
      <div className="text-xs text-slate-600">
        {vis.noindex || vis.robotsBlocks ? (
          <span className="text-red-700">{vis.noindex ? "Page says noindex" : "Blocked by robots.txt"}</span>
        ) : (
          "Open to search engines"
        )}
        {vis.foreignCanonical && <div className="mt-0.5 text-amber-700">Canonical on another domain</div>}
      </div>
    );
  }
  const form = view.monitor.monitor_type === "contact_form" ? contactFormInfo(s.last_metadata) : null;
  if (form) {
    const names = [...form.forms.map((f) => f.builder), ...form.embeds.map((e) => e.builder)];
    return (
      <div className="text-xs text-slate-600">
        {names.length > 0 ? `${[...new Set(names)].join(", ")} form${names.length === 1 ? "" : "s"}` : "No form found"}
        {form.mail && <> · email {form.mail.failures.length > 0 || form.mail.test.ok === false ? "failing" : "OK"}</>}
        {s.last_error_message && <div className="mt-0.5 text-red-700">{s.last_error_message}</div>}
      </div>
    );
  }
  const speed = view.monitor.monitor_type === "page_speed" ? pageSpeedInfo(s.last_metadata) : null;
  if (speed) {
    return (
      <div className="text-xs text-slate-600">
        {speed.score !== null ? <>Score {speed.score}/100</> : "No score"} · LCP {formatSeconds(speed.lab.lcpMs)}
        {s.last_error_message && <div className="mt-0.5 text-amber-700">{s.last_error_message}</div>}
      </div>
    );
  }
  const dom = view.monitor.monitor_type === "domain_expiry" ? domainExpiryInfo(s.last_metadata) : null;
  if (dom) {
    return (
      <div className="text-xs text-slate-600">
        {dom.expiresAt ? <>Expires {formatDate(dom.expiresAt)}</> : "No expiry date"}
        {dom.daysLeft !== null && dom.daysLeft >= 0 && <> · {dom.daysLeft} days</>}
        {s.last_error_message && <div className="mt-0.5 text-red-700">{s.last_error_message}</div>}
      </div>
    );
  }
  const wp = view.monitor.monitor_type === "wordpress_health" ? wordpressInfo(s.last_metadata) : null;
  if (wp) {
    const behind = wp.version && wp.latest && compareVersions(wp.version, wp.latest) < 0;
    // Only the site plugin knows about every update.
    const pluginUpdates = wp.report ? wp.plugins.filter((p) => p.latest).length : 0;
    return (
      <div className="text-xs text-slate-600">
        {wp.version ? <>WordPress {wp.version}</> : "WordPress version hidden"}
        {behind && <span className="text-amber-700"> ({wp.latest} available)</span>}
        {pluginUpdates > 0 && (
          <span className="text-amber-700">
            {" "}
            · {pluginUpdates} plugin update{pluginUpdates === 1 ? "" : "s"}
          </span>
        )}
        {wp.wpengine?.last_backup_at && <> · backup {timeAgo(wp.wpengine.last_backup_at)}</>}
        {wp.problems.some((p) => p.level === "critical") && (
          <div className="mt-0.5 text-red-700">{wp.problems.filter((p) => p.level === "critical").map((p) => p.message).join("; ")}</div>
        )}
      </div>
    );
  }
  const tags = view.monitor.monitor_type === "tracking_tags" ? trackingInfo(s.last_metadata) : null;
  if (tags) {
    const foundCount = Object.keys(tags.found).length;
    return (
      <div className="text-xs text-slate-600">
        {foundCount} tag{foundCount === 1 ? "" : "s"} found
        {tags.missing.length > 0 ? (
          <div className="mt-0.5 text-red-700">
            Missing: {tags.missing.map((t) => (isTrackingTag(t) ? TRACKING_TAGS[t].label : t)).join(", ")}
          </div>
        ) : (
          tags.expected.length > 0 && <> · all {tags.expected.length} expected present</>
        )}
      </div>
    );
  }
  const scan = view.monitor.monitor_type === "broken_links" ? linkScanInfo(s.last_metadata) : null;
  if (scan) {
    return (
      <div className="text-xs text-slate-600">
        {scan.checked} links checked
        {scan.broken.length > 0 ? (
          <span className="text-red-700"> · {scan.broken.length} broken</span>
        ) : (
          <> · none broken</>
        )}
      </div>
    );
  }
  const cert = view.monitor.monitor_type === "ssl_expiry" ? certificateInfo(s.last_metadata) : null;
  if (cert) {
    return (
      <div className="text-xs text-slate-600">
        Expires {formatDate(cert.validTo)}
        {cert.daysLeft !== null && cert.daysLeft >= 0 && <> · {cert.daysLeft} days</>}
        {s.last_error_message && <div className="mt-0.5 text-red-700">{s.last_error_message}</div>}
      </div>
    );
  }
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
                  {(countsTowardUptime(monitor.monitor_type) &&
                    formatUptime(view.uptime?.passed_7d ?? 0, view.uptime?.checks_7d ?? 0)) || (
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
