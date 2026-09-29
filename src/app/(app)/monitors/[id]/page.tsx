import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckHistoryTable } from "@/components/check-history-table";
import { RunCheckButton } from "@/components/run-check-button";
import { CheckStatusBadge, HealthBadge, IncidentStatusBadge, SeverityBadge } from "@/components/status";
import { LinkButton, Panel, PageHeader, When } from "@/components/ui";
import { getAppDataFor, getCheckHistory, getDailyUptime, getDataSource, getScoreHistory, type MonitorView } from "@/lib/data";
import { UptimeBars, UptimeLegend } from "@/components/uptime-bars";
import { dayBars, recentDays } from "@/lib/uptime-history";
import { ScoreTrend } from "@/components/score-trend";
import {
  APP_TIMEZONE,
  certificateInfo,
  displayUrl,
  linkScanInfo,
  trackingInfo,
  wordpressInfo,
  visibilityInfo,
  domainExpiryInfo,
  pageSpeedInfo,
  formatSeconds,
  contactFormInfo,
  formatDate,
  formatDateTime,
  formatUptime,
  isInFuture,
  timeAgo,
} from "@/lib/format";
import { failingSince } from "@/lib/health";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS, SEVERITY_LABELS, countsTowardUptime, formatInterval } from "@/lib/labels";
import { TRACKING_TAGS, TRACKING_TAG_KEYS } from "@/lib/monitoring/tracking";
import { compareVersions } from "@/lib/monitoring/wordpress";
import { WP_PLUGIN_VERSION } from "@/lib/monitoring/wp-plugin";
import { getSettings } from "@/lib/settings-store";

// Run check can start a broken link scan, which takes up to ~40 seconds.
export const maxDuration = 60;

const HISTORY_LIMIT = 50;

async function findMonitor(id: string): Promise<MonitorView | undefined> {
  const data = await getAppDataFor("monitor", id);
  return data?.monitors.find((m) => m.monitor.id === id);
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

const WP_SOURCES: Record<string, string> = { plugin: "the Website Watch plugin", wpengine: "WP Engine" };

export default async function MonitorDetailPage({ params }: PageProps<"/monitors/[id]">) {
  const view = await findMonitor((await params).id);
  if (!view) notFound();

  const { monitor, website, client, summary, health, activeIncident, uptime } = view;
  const isSsl = monitor.monitor_type === "ssl_expiry";
  const isLinkScan = monitor.monitor_type === "broken_links";
  const isTracking = monitor.monitor_type === "tracking_tags";
  const isWordPress = monitor.monitor_type === "wordpress_health";
  const isVisibility = monitor.monitor_type === "search_visibility";
  const isDomain = monitor.monitor_type === "domain_expiry";
  const isSpeed = monitor.monitor_type === "page_speed";
  const isForm = monitor.monitor_type === "contact_form";
  const form = isForm ? contactFormInfo(summary?.last_metadata) : null;
  const speed = isSpeed ? pageSpeedInfo(summary?.last_metadata) : null;
  const vis = isVisibility ? visibilityInfo(summary?.last_metadata) : null;
  const dom = isDomain ? domainExpiryInfo(summary?.last_metadata) : null;
  const wp = isWordPress ? wordpressInfo(summary?.last_metadata) : null;
  const tags = isTracking ? trackingInfo(summary?.last_metadata) : null;
  const cert = isSsl ? certificateInfo(summary?.last_metadata) : null;
  const scan = isLinkScan ? linkScanInfo(summary?.last_metadata) : null;
  const uptimeRows = [
    { label: "Last 24 hours", passed: uptime?.passed_24h ?? 0, checks: uptime?.checks_24h ?? 0 },
    { label: "Last 7 days", passed: uptime?.passed_7d ?? 0, checks: uptime?.checks_7d ?? 0 },
    { label: "Last 30 days", passed: uptime?.passed_30d ?? 0, checks: uptime?.checks_30d ?? 0 },
  ];
  const showsUptime = countsTowardUptime(monitor.monitor_type);
  const [history, rules, scoreHistory, daily] = await Promise.all([
    getCheckHistory(monitor.id, HISTORY_LIMIT),
    getSettings(),
    monitor.monitor_type === "page_speed" ? getScoreHistory(monitor.id) : Promise.resolve([]),
    showsUptime ? getDailyUptime([monitor.id]) : Promise.resolve(new Map()),
  ]);
  const uptimeBars = dayBars(recentDays(new Date(), 90, APP_TIMEZONE), daily.get(monitor.id) ?? []);
  const since = failingSince(history);

  let disabledReason: string | undefined;
  if (getDataSource() === "sample") disabledReason = "Connect Supabase to run real checks";
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
        <div className="space-y-6">
          {showsUptime && (
            <Panel title="Uptime history" aside="Last 90 days">
              <div className="space-y-3 px-4 py-4">
                <UptimeBars bars={uptimeBars} />
                <UptimeLegend />
              </div>
            </Panel>
          )}
          {isSpeed && (
            <Panel title="Score trend" aside="Last 90 days · mobile">
              <ScoreTrend points={scoreHistory} minScore={rules.minPerformanceScore} />
            </Panel>
          )}
          <Panel title="Recent checks" aside={`Latest ${Math.min(history.length, HISTORY_LIMIT)}`}>
            <CheckHistoryTable checks={history} monitorType={monitor.monitor_type} />
          </Panel>
        </div>

        <div className="space-y-6">
          {isForm ? (
            <Panel title="Contact form">
              {!form ? (
                <p className="px-4 py-4 text-sm text-slate-500">{summary?.last_error_message ?? "Not checked yet."}</p>
              ) : (
                <dl>
                  <ConfigRow label="On the page">
                    {form.forms.length + form.embeds.length === 0 ? (
                      <span className="text-red-700">No form found</span>
                    ) : (
                      <>
                        {form.forms.map((f, i) => (
                          <span key={`f${i}`} className="block">
                            {f.builder}
                            {f.id && ` #${f.id}`} · {f.fields} field{f.fields === 1 ? "" : "s"}
                            {!f.hasSubmit && <span className="text-red-700"> · no submit button</span>}
                          </span>
                        ))}
                        {form.embeds.map((e, i) => {
                          const hs = form.hubspot.find((h) => h.id === e.id);
                          return (
                            <span key={`e${i}`} className="block">
                              {e.builder}
                              {e.id && ` ${e.id.slice(0, 8)}…`} <span className="text-xs text-slate-500">(loaded by script)</span>
                              {hs?.status === "ok" && (
                                <span className="text-xs text-fig-teal">
                                  {" "}
                                  · live in HubSpot{hs.fields !== null && `, ${hs.fields} fields`}
                                </span>
                              )}
                              {hs?.status === "missing" && <span className="text-xs text-red-700"> · deleted in HubSpot</span>}
                              {hs?.status === "unpublished" && <span className="text-xs text-red-700"> · not published in HubSpot</span>}
                              {hs?.status === "unknown" && <span className="text-xs text-slate-500"> · HubSpot didn&apos;t answer</span>}
                            </span>
                          );
                        })}
                      </>
                    )}
                    {form.captcha && <span className="block text-xs text-slate-500">Spam protection (CAPTCHA) found</span>}
                    {form.errors.map((e) => (
                      <span key={e} className="block text-red-700">
                        {e}
                      </span>
                    ))}
                  </ConfigRow>
                  <ConfigRow label="Site email">
                    {form.embeds.some((e) => e.builder === "HubSpot") && (
                      <span className="block text-xs text-slate-500">
                        HubSpot forms are emailed by HubSpot, so the site&apos;s email doesn&apos;t affect them.
                      </span>
                    )}
                    {!form.mail ? (
                      <span className="text-slate-500">
                        {form.pluginNote ?? "Install the Website Watch plugin to check the site's email (Settings → WordPress plugin)"}
                      </span>
                    ) : (
                      <>
                        {form.mail.failures.length === 0 ? (
                          <span className="block text-fig-teal">No failed emails in the last 7 days</span>
                        ) : (
                          form.mail.failures.map((f) => (
                            <span key={f.message} className="block text-red-700">
                              {f.count} failed{f.lastAt && `, last ${timeAgo(f.lastAt)}`}: {f.message}
                            </span>
                          ))
                        )}
                        {form.mail.lastSentAt && (
                          <span className="block text-xs text-slate-500">Last email sent {timeAgo(form.mail.lastSentAt)}</span>
                        )}
                      </>
                    )}
                  </ConfigRow>
                  {form.mail && (
                    <ConfigRow label="Daily test email">
                      {!form.mail.test.configured ? (
                        <span className="text-slate-500">Off (set WEBSITE_WATCH_TEST_EMAIL and re-install the plugin)</span>
                      ) : form.mail.test.ok === null ? (
                        <span className="text-slate-500">Hasn&apos;t run yet</span>
                      ) : form.mail.test.ok ? (
                        <span className="text-fig-teal">Sent {form.mail.test.lastAt ? timeAgo(form.mail.test.lastAt) : ""}</span>
                      ) : (
                        <span className="text-red-700">Failed: {form.mail.test.error}</span>
                      )}
                    </ConfigRow>
                  )}
                </dl>
              )}
            </Panel>
          ) : isSpeed ? (
            <Panel
              title="Page speed (mobile)"
              aside={
                <a
                  href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(monitor.target_url)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fig-plum hover:underline"
                >
                  Full report
                </a>
              }
            >
              {!speed ? (
                <p className="px-4 py-4 text-sm text-slate-500">{summary?.last_error_message ?? "Not checked yet."}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2 px-4 pt-4">
                    <span
                      className={`font-display text-3xl font-bold ${
                        speed.score === null
                          ? "text-slate-400"
                          : speed.score >= 90
                            ? "text-fig-teal"
                            : speed.score >= rules.minPerformanceScore
                              ? "text-amber-700"
                              : "text-red-700"
                      }`}
                    >
                      {speed.score ?? "–"}
                    </span>
                    <span className="text-sm text-slate-500">/ 100 performance score</span>
                  </div>
                  <dl className="mt-2">
                    <ConfigRow label="Largest paint (LCP)">{formatSeconds(speed.lab.lcpMs)}</ConfigRow>
                    <ConfigRow label="First paint (FCP)">{formatSeconds(speed.lab.fcpMs)}</ConfigRow>
                    <ConfigRow label="Blocking time (TBT)">
                      {speed.lab.tbtMs !== null ? `${Math.round(speed.lab.tbtMs)} ms` : "–"}
                    </ConfigRow>
                    <ConfigRow label="Layout shift (CLS)">{speed.lab.cls !== null ? speed.lab.cls.toFixed(3) : "–"}</ConfigRow>
                    <ConfigRow label="Real visitors">
                      {!speed.field ? (
                        <span className="text-slate-500">Not enough Chrome traffic for Google&apos;s data</span>
                      ) : (
                        <>
                          {(
                            [
                              ["LCP", speed.field.lcp, (v: number) => formatSeconds(v)],
                              ["INP", speed.field.inp, (v: number) => `${Math.round(v)} ms`],
                              ["CLS", speed.field.cls, (v: number) => v.toFixed(2)],
                            ] as const
                          ).map(([label, metric, show]) =>
                            metric ? (
                              <span key={label} className="block">
                                {label} {show(metric.p75)}{" "}
                                <span className={metric.category === "FAST" ? "text-fig-teal" : "text-amber-700"}>
                                  ({metric.category === "FAST" ? "good" : metric.category === "SLOW" ? "poor" : "needs work"})
                                </span>
                              </span>
                            ) : null,
                          )}
                          <span className="block text-xs text-slate-500">
                            75th percentile, last 28 days{speed.field.source === "origin" ? ", whole site" : ""}
                          </span>
                        </>
                      )}
                    </ConfigRow>
                  </dl>
                  {speed.opportunities.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Biggest wins</div>
                      <ul className="space-y-0.5 text-xs">
                        {speed.opportunities.map((o) => (
                          <li key={o.title} className="flex justify-between gap-2">
                            <span className="text-fig-ink">{o.title}</span>
                            <span className="shrink-0 text-slate-500">~{formatSeconds(o.savingsMs)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </Panel>
          ) : isVisibility ? (
            <Panel title="Search visibility">
              {!vis ? (
                <p className="px-4 py-4 text-sm text-slate-500">Not checked yet.</p>
              ) : (
                <dl>
                  <ConfigRow label="Page">
                    {vis.noindex ? (
                      <>
                        <span className="text-red-700">Tells search engines not to index it</span>
                        <code className="mt-0.5 block text-xs break-all text-slate-500">{vis.noindex}</code>
                        <span className="block text-xs text-slate-500">
                          On WordPress: Settings → Reading → untick &quot;Discourage search engines&quot;.
                        </span>
                      </>
                    ) : (
                      <span className="text-fig-teal">Indexable</span>
                    )}
                  </ConfigRow>
                  <ConfigRow label="robots.txt">
                    {vis.robotsBlocks ? (
                      <span className="text-red-700">Blocks this page</span>
                    ) : vis.robotsStatus === null ? (
                      <span className="text-amber-700">Couldn&apos;t be reached</span>
                    ) : vis.robotsStatus >= 500 ? (
                      <span className="text-amber-700">HTTP {vis.robotsStatus}: Google pauses crawling</span>
                    ) : vis.robotsStatus >= 400 ? (
                      <span className="text-slate-500">None (allows everything)</span>
                    ) : (
                      <span className="text-fig-teal">Allows this page</span>
                    )}
                  </ConfigRow>
                  <ConfigRow label="Canonical URL">
                    {vis.foreignCanonical ? (
                      <span className="text-amber-700">
                        Points to another domain: <span className="break-all">{vis.foreignCanonical}</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">This domain (or none)</span>
                    )}
                  </ConfigRow>
                </dl>
              )}
            </Panel>
          ) : isDomain ? (
            <Panel title="Domain">
              {!dom ? (
                <p className="px-4 py-4 text-sm text-slate-500">{summary?.last_error_message ?? "Not checked yet."}</p>
              ) : (
                <dl>
                  <ConfigRow label="Domain">{dom.domain}</ConfigRow>
                  <ConfigRow label="Expires">
                    {dom.expiresAt ? formatDate(dom.expiresAt) : <span className="text-slate-500">Unknown</span>}
                    {dom.daysLeft !== null && (
                      <span className={`block text-xs ${dom.daysLeft <= 30 ? "text-amber-700" : "text-slate-500"}`}>
                        {dom.daysLeft >= 0 ? `${dom.daysLeft} days left` : "Expired"}
                      </span>
                    )}
                  </ConfigRow>
                  <ConfigRow label="Registrar">{dom.registrar ?? <span className="text-slate-500">Unknown</span>}</ConfigRow>
                  <ConfigRow label="Status">
                    {dom.statuses.length > 0 ? dom.statuses.join(", ") : <span className="text-slate-500">None listed</span>}
                  </ConfigRow>
                </dl>
              )}
            </Panel>
          ) : isWordPress ? (
            <Panel title="WordPress">
              {!wp ? (
                <p className="px-4 py-4 text-sm text-slate-500">Not checked yet.</p>
              ) : (
                <>
                  <dl>
                    <ConfigRow label="WordPress">
                      {wp.version ?? <span className="text-slate-500">Hidden</span>}
                      {wp.version && wp.latest && compareVersions(wp.version, wp.latest) < 0 ? (
                        <span className="text-xs text-amber-700"> · {wp.latest} available</span>
                      ) : (
                        wp.version && <span className="text-xs text-fig-teal"> · up to date</span>
                      )}
                      {wp.source && <span className="block text-xs text-slate-500">from {WP_SOURCES[wp.source] ?? `the site's ${wp.source}`}</span>}
                    </ConfigRow>
                    <ConfigRow label="PHP">
                      {wp.php ?? <span className="text-slate-500">Unknown (needs WP Engine)</span>}
                      {wp.php && rules.minPhpVersion && compareVersions(wp.php, rules.minPhpVersion) < 0 && (
                        <span className="text-xs text-amber-700"> · unsupported</span>
                      )}
                    </ConfigRow>
                    <ConfigRow label="WP Engine">
                      {wp.wpengine ? (
                        <>
                          {wp.wpengine.install} · {wp.wpengine.environment}
                          {wp.wpengine.status !== "active" && <span className="text-amber-700"> · {wp.wpengine.status}</span>}
                        </>
                      ) : (
                        <span className="text-slate-500">{wp.note ?? "Not linked"}</span>
                      )}
                    </ConfigRow>
                    {wp.wpengine && (
                      <ConfigRow label="Last backup">
                        {wp.wpengine.last_backup_at ? (
                          <When iso={wp.wpengine.last_backup_at} />
                        ) : (
                          <span className="text-red-700">None completed</span>
                        )}
                        {wp.wpengine.latest_backup_status && wp.wpengine.latest_backup_status !== "completed" && (
                          <span className="block text-xs text-red-700">Latest: {wp.wpengine.latest_backup_status}</span>
                        )}
                      </ConfigRow>
                    )}
                    {wp.report ? (
                      <ConfigRow label="Themes">
                        {wp.report.themes
                          .filter((t) => t.active || t.latest)
                          .map((t) => (
                            <span key={t.slug} className="block">
                              {t.name} {t.version}
                              {t.latest && <span className="text-xs text-amber-700"> → {t.latest}</span>}
                              {!t.active && <span className="text-xs text-slate-500"> (inactive)</span>}
                            </span>
                          ))}
                      </ConfigRow>
                    ) : (
                      wp.themes.length > 0 && <ConfigRow label="Theme">{wp.themes.join(", ")}</ConfigRow>
                    )}
                    <ConfigRow label="Site plugin">
                      {wp.report ? (
                        <>
                          Reporting{wp.report.plugin_version && <> · version {wp.report.plugin_version}</>}
                          {wp.report.memory_limit && <> · PHP memory {wp.report.memory_limit}</>}
                          {wp.report.plugin_version && compareVersions(wp.report.plugin_version, WP_PLUGIN_VERSION) < 0 && (
                            <span className="block text-xs text-amber-700">
                              Version {WP_PLUGIN_VERSION} is available: download it from Settings → WordPress plugin and
                              upload it over this one.
                            </span>
                          )}
                          <span className="block text-xs text-slate-500">
                            WordPress last checked for updates{" "}
                            {wp.report.updates_checked_at ? timeAgo(wp.report.updates_checked_at) : "never"}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">{wp.pluginNote ?? "Not set up (Settings → WordPress plugin)"}</span>
                      )}
                    </ConfigRow>
                  </dl>
                  {wp.plugins.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                        {wp.report ? "Plugins" : "Plugins seen on the page"} ({wp.plugins.length})
                      </div>
                      <ul className="space-y-0.5 text-xs">
                        {wp.plugins.map((p, i) => {
                          // The site plugin reports WordPress's own update offers; public versions are compared.
                          const outdated =
                            p.version && p.latest && (p.source === "plugin" || compareVersions(p.version, p.latest) < 0);
                          return (
                            <li key={`${p.slug}-${i}`} className="flex justify-between gap-2">
                              <span className="text-fig-ink">
                                {p.name ?? p.slug}
                                {p.active === false && <span className="text-slate-500"> (inactive)</span>}
                              </span>
                              <span className={outdated ? "text-amber-700" : "text-slate-500"}>
                                {p.version ?? "version hidden"}
                                {outdated && ` → ${p.latest}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {!wp.report && (
                        <p className="mt-2 text-xs text-slate-500">
                          Only plugins visible from outside, and update info only for free wordpress.org plugins. The
                          Website Watch plugin shows all of them, premium included.
                        </p>
                      )}
                    </div>
                  )}
                  {wp.report && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                        PHP errors (last 7 days)
                      </div>
                      {!wp.report.fatal_errors ? (
                        <p className="text-xs text-slate-500">
                          Update the Website Watch plugin on this site (Settings → WordPress plugin) to track PHP errors.
                        </p>
                      ) : wp.report.fatal_errors.length === 0 ? (
                        <p className="text-xs text-slate-500">None recorded.</p>
                      ) : (
                        <ul className="space-y-2 text-xs">
                          {wp.report.fatal_errors.map((e, i) => (
                            <li key={i}>
                              <div className="flex justify-between gap-2">
                                <span className="font-medium text-red-700">{e.source}</span>
                                <span className="shrink-0 text-slate-500">
                                  {e.count > 1 && <>×{e.count} · </>}
                                  {e.last_at ? timeAgo(e.last_at) : ""}
                                </span>
                              </div>
                              <div className="break-words text-fig-ink">{e.message}</div>
                              {/* PHP messages usually end with "in file:line" already. */}
                              {e.file && !e.message.includes(e.file) && (
                                <div className="text-slate-500">
                                  {e.file}
                                  {e.line > 0 && `:${e.line}`}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </Panel>
          ) : isTracking ? (
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
                  {rules.sslWarningDays} days left{" "}
                  <span className="text-xs text-slate-500">(fails at {rules.sslFailureDays} days, expired or untrusted)</span>
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
              {!isSsl && !isLinkScan && !isTracking && !isWordPress && !isVisibility && !isDomain && !isSpeed && !isForm && (
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
                  {monitor.max_response_time_ms ?? `${rules.defaultMaxResponseMs} (default)`} ms
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
