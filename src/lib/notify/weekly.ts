// Weekly summary: one Slack message every Monday morning listing what needs
// work across all sites (open incidents, backups, PHP errors, certificates,
// WordPress updates, broken links, missing tags). Pure (relative imports only) so it can
// be tested directly. Scheduling and sending live in weekly-send.ts.
import { certificateInfo, formatDate, linkScanInfo, trackingInfo, wordpressInfo } from "../format.ts";
import { countsTowardUptime } from "../labels.ts";
import { TRACKING_TAGS, isTrackingTag } from "../monitoring/tracking.ts";
import { compareVersions } from "../monitoring/wordpress.ts";
import type { CheckStatus, Environment, MonitorType, Severity } from "../types.ts";

/** Monday at this hour (APP_TIMEZONE); a late scheduler catches up later in the week. */
export const SUMMARY_WEEKDAY_HOUR = 9;
/** Certificates expiring within this many days are listed. */
export const SUMMARY_SSL_DAYS = 30;
/** Lines per section before "…and N more". */
const MAX_LINES = 15;
/** Slack's limit for a section's text is 3000 characters. */
const MAX_SECTION_CHARS = 2800;

export interface SummaryMonitor {
  clientName: string;
  websiteUrl: string;
  environment: Environment;
  monitorType: MonitorType;
  lastStatus: CheckStatus | null;
  lastErrorMessage: string | null;
  metadata: Record<string, unknown> | null;
  checks7d: number;
  passed7d: number;
}

export interface SummaryIncident {
  clientName: string;
  /** Type of the monitor that opened it, if it still exists. */
  monitorType: MonitorType | null;
  title: string;
  severity: Severity;
  /** Unresolved incidents only matter for "needs attention now". */
  resolved: boolean;
  firstDetectedAt: string;
}

export interface SummaryInput {
  /** Active monitors of active websites and clients. */
  monitors: SummaryMonitor[];
  incidents: SummaryIncident[];
  now: Date;
  appUrl: string | null;
}

// Timing ------------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The week a summary belongs to (its Monday, as YYYY-MM-DD in `timeZone`), and
 * whether it's due: from Monday SUMMARY_WEEKDAY_HOUR:00 until the week ends.
 */
export function summaryWeek(now: Date, timeZone: string): { weekStart: string; due: boolean } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dayIndex = WEEKDAYS.indexOf(parts.weekday);
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const monday = new Date(local - dayIndex * 86_400_000).toISOString().slice(0, 10);
  return { weekStart: monday, due: dayIndex > 0 || Number(parts.hour) >= SUMMARY_WEEKDAY_HOUR };
}

// Message -----------------------------------------------------------------------------

/** Slack's mrkdwn treats &, < and > specially; escape anything we didn't write. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function site(m: Pick<SummaryMonitor, "clientName" | "websiteUrl" | "environment">): string {
  let host = m.websiteUrl;
  try {
    host = new URL(m.websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    // Keep the raw URL.
  }
  const env = m.environment === "production" ? "" : ` (${m.environment})`;
  return `*${esc(m.clientName)}* ${esc(host)}${env}`;
}

/** Joins lines up to the section limits, then "…and N more". */
function section(title: string, lines: string[]): unknown | null {
  if (lines.length === 0) return null;
  const kept: string[] = [];
  let size = title.length;
  for (const line of lines) {
    if (kept.length >= MAX_LINES || size + line.length + 1 > MAX_SECTION_CHARS) break;
    kept.push(line);
    size += line.length + 1;
  }
  const more = lines.length - kept.length;
  const text = [title, ...kept, ...(more > 0 ? [`_…and ${more} more_`] : [])].join("\n");
  return { type: "section", text: { type: "mrkdwn", text } };
}

/** Warnings from these monitors are listed in their own sections, not as incidents. */
const OWN_SECTION: MonitorType[] = ["wordpress_health", "ssl_expiry", "broken_links", "tracking_tags"];

/** "Akismet Anti-spam: Spam Protection" → "Akismet Anti-spam". */
function shortName(name: string): string {
  return name.split(/: | [-–|] /)[0].trim() || name;
}

function percent(passed: number, total: number): string {
  if (total === 0) return "no data";
  const value = (passed / total) * 100;
  return `${value === 100 ? "100" : value.toFixed(2)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface WeeklySummary {
  text: string;
  blocks: unknown[];
  /** Whether anything needs work; an all-clear week still gets a short message. */
  hasIssues: boolean;
}

export function buildWeeklySummary({ monitors, incidents, now, appUrl }: SummaryInput): WeeklySummary {
  const weekAgo = now.getTime() - 7 * 86_400_000;

  // Overview.
  const websites = new Set(monitors.map((m) => m.websiteUrl)).size;
  const availability = monitors.filter((m) => countsTowardUptime(m.monitorType));
  const checks = availability.reduce((n, m) => n + m.checks7d, 0);
  const passed = availability.reduce((n, m) => n + m.passed7d, 0);
  const openedThisWeek = incidents.filter((i) => new Date(i.firstDetectedAt).getTime() >= weekAgo).length;
  const unresolved = incidents.filter((i) => !i.resolved);
  const open = unresolved
    .filter((i) => i.severity === "critical" || !i.monitorType || !OWN_SECTION.includes(i.monitorType))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));

  // Needs attention now: unresolved incidents, critical first.
  const incidentLines = open.map(
    (i) =>
      `${i.severity === "critical" ? ":red_circle:" : ":large_orange_circle:"} *${esc(i.clientName)}* ${esc(i.title)} ` +
      `(since ${formatDate(i.firstDetectedAt)})`,
  );

  const backupLines: string[] = [];
  const phpLines: { line: string; total: number }[] = [];
  const wordpressLines: { line: string; weight: number }[] = [];
  const sslLines: { line: string; days: number }[] = [];
  const linkLines: string[] = [];
  const tagLines: string[] = [];

  for (const m of monitors) {
    if (m.monitorType === "wordpress_health") {
      const wp = wordpressInfo(m.metadata);
      if (!wp) continue;
      for (const p of wp.problems.filter((p) => p.level === "critical" && /backup/i.test(p.message))) {
        backupLines.push(`${site(m)}: ${esc(p.message)}`);
      }
      const fatal = wp.report?.fatal_errors ?? [];
      if (fatal.length > 0) {
        const total = fatal.reduce((n, e) => n + e.count, 0);
        const bySource = new Map<string, number>();
        for (const e of fatal) bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.count);
        const sources = [...bySource].map(([name, n]) => `${esc(name)} ×${n}`).join(", ");
        const last = fatal.map((e) => e.last_at ?? "").sort().at(-1);
        phpLines.push({
          line: `${site(m)}: ${plural(total, "fatal error")} (${sources})${last ? `, last ${formatDate(last)}` : ""}`,
          total,
        });
      }
      const parts: string[] = [];
      let weight = 0;
      if (wp.version && wp.latest && compareVersions(wp.version, wp.latest) < 0) {
        parts.push(`WordPress ${esc(wp.version)} → ${esc(wp.latest)}`);
        weight += 5;
      }
      // Only the site plugin knows every update; public versions are compared.
      const updates = wp.plugins.filter(
        (p) => p.version && p.latest && (p.source === "plugin" || compareVersions(p.version, p.latest) < 0),
      );
      if (updates.length > 0) {
        const names = updates.slice(0, 4).map((p) => esc(shortName(p.name ?? p.slug)));
        const rest = updates.length - names.length;
        parts.push(`${plural(updates.length, "plugin update")} (${names.join(", ")}${rest > 0 ? `, +${rest}` : ""})`);
        weight += updates.length;
      }
      const themes = wp.report?.themes.filter((t) => t.latest).length ?? 0;
      if (themes > 0) parts.push(plural(themes, "theme update"));
      if (parts.length > 0) wordpressLines.push({ line: `${site(m)}: ${parts.join(" · ")}`, weight });
    } else if (m.monitorType === "ssl_expiry") {
      const cert = certificateInfo(m.metadata);
      if (cert && cert.daysLeft !== null && cert.daysLeft <= SUMMARY_SSL_DAYS) {
        const when = cert.daysLeft < 0 ? "*expired*" : `expires ${formatDate(cert.validTo)} (${plural(cert.daysLeft, "day")})`;
        sslLines.push({ line: `${site(m)}: ${when}`, days: cert.daysLeft });
      }
    } else if (m.monitorType === "broken_links") {
      const scan = linkScanInfo(m.metadata);
      if (scan && scan.broken.length > 0) linkLines.push(`${site(m)}: ${plural(scan.broken.length, "broken link")}`);
    } else if (m.monitorType === "tracking_tags") {
      const tags = trackingInfo(m.metadata);
      if (tags && tags.missing.length > 0) {
        const names = tags.missing.map((t) => (isTrackingTag(t) ? TRACKING_TAGS[t].label : t));
        tagLines.push(`${site(m)}: missing ${esc(names.join(", "))}`);
      }
    }
  }

  const sections = [
    section(":rotating_light: *Needs attention now*", incidentLines),
    section(":floppy_disk: *Backups*", backupLines),
    section(
      ":boom: *PHP errors (last 7 days)*",
      phpLines.sort((a, b) => b.total - a.total).map((l) => l.line),
    ),
    section(
      `:lock: *SSL certificates expiring within ${SUMMARY_SSL_DAYS} days*`,
      sslLines.sort((a, b) => a.days - b.days).map((l) => l.line),
    ),
    section(
      ":wrench: *WordPress updates*",
      wordpressLines.sort((a, b) => b.weight - a.weight).map((l) => l.line),
    ),
    section(":link: *Broken links*", linkLines),
    section(":label: *Missing tracking tags*", tagLines),
  ].filter(Boolean);

  const title = `Weekly website report · week of ${formatDate(now.toISOString())}`;
  const overview =
    `${plural(websites, "website")} · uptime ${percent(passed, checks)} (7 days) · ` +
    `${plural(openedThisWeek, "incident")} this week, ${unresolved.length} still open`;
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    { type: "section", text: { type: "mrkdwn", text: overview } },
    { type: "divider" },
    ...(sections.length > 0
      ? sections
      : [{ type: "section", text: { type: "mrkdwn", text: ":white_check_mark: All clear: nothing needs work this week." } }]),
  ];
  if (appUrl) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open Website Watch" }, url: appUrl }],
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Sent every Monday morning. Critical problems still alert right away." }],
  });
  return { text: `${title}: ${overview}`, blocks, hasIssues: sections.length > 0 };
}
