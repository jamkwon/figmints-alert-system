// Monthly client report: uptime, incidents, page speed, WordPress work done,
// backups, PHP errors, SSL and domain dates, search visibility, for one client
// and one calendar month (APP_TIMEZONE). Pure: data loading lives in data.ts.
import { countsTowardUptime } from "./labels.ts";
import { compareVersions } from "./monitoring/wordpress.ts";
import type { CheckStatus, Environment, MonitorType, Severity } from "./types.ts";

// Months ------------------------------------------------------------------------------

function offsetMs(at: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Midnight at the start of a local day in `timeZone`, as an instant. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

export interface ReportMonth {
  /** "2026-09" */
  key: string;
  /** "September 2026" */
  label: string;
  start: Date;
  end: Date;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function monthRange(key: string, timeZone: string): ReportMonth | null {
  const m = key.match(MONTH_KEY);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = localMidnight(year, month, 1, timeZone);
  const end = month === 12 ? localMidnight(year + 1, 1, 1, timeZone) : localMidnight(year, month + 1, 1, timeZone);
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  );
  return { key, label, start, end };
}

/** The current month and the ones before it (check history is kept 90 days, so three in all). */
export function recentMonths(now: Date, timeZone: string, count = 3): string[] {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(+p.year, +p.month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

// Input -------------------------------------------------------------------------------

export interface ReportWebsite {
  id: string;
  name: string;
  url: string;
  environment: Environment;
}

export interface ReportMonitor {
  id: string;
  websiteId: string;
  name: string;
  type: MonitorType;
}

export interface ReportCheck {
  monitorId: string;
  checkedAt: string;
  status: CheckStatus;
  passed: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ReportIncident {
  title: string;
  severity: Severity;
  firstDetectedAt: string;
  resolvedAt: string | null;
}

export interface ReportInput {
  month: ReportMonth;
  now: Date;
  websites: ReportWebsite[];
  monitors: ReportMonitor[];
  /** Check counts in the month for availability monitors (HTTP, content, response time). */
  uptime: { monitorId: string; checks: number; passed: number }[];
  /** Checks in the month for the other monitors, oldest first. */
  checks: ReportCheck[];
  /** Incidents open at any point in the month. */
  incidents: ReportIncident[];
}

// Output ------------------------------------------------------------------------------

export interface WordPressWork {
  website: string;
  core: { from: string; to: string } | null;
  pluginUpdates: { name: string; from: string; to: string }[];
  themeUpdates: { name: string; from: string; to: string }[];
  /** Updates still available at the end of the month. */
  pendingUpdates: number;
  lastBackupAt: string | null;
  /** Checks in the month that found a backup problem. */
  backupProblems: number;
  /** Fatal PHP errors seen in the month (approximate), by plugin or theme. */
  phpErrors: { source: string; count: number }[];
  /** Plugin and theme lists come from the site plugin, so every update is known. */
  fullDetail: boolean;
}

export interface MonthlyReport {
  month: ReportMonth;
  /** The month isn't over yet. */
  inProgress: boolean;
  overview: {
    uptime: number | null;
    /** Availability checks the uptime is based on. */
    checks: number;
    incidents: number;
    /** Mean time from detection to resolution, for incidents resolved in the month. */
    meanMinutesToResolve: number | null;
  };
  websites: { name: string; url: string; environment: Environment; uptime: number | null; checks: number }[];
  incidents: { title: string; severity: Severity; openedAt: string; resolvedAt: string | null; minutes: number | null }[];
  pageSpeed: { website: string; url: string; latest: number | null; min: number; max: number; average: number; tests: number; latestLcpMs: number | null }[];
  wordpress: WordPressWork[];
  ssl: { website: string; validTo: string }[];
  domains: { domain: string; expiresAt: string; registrar: string | null }[];
  visibility: { website: string; checks: number; problems: number; latestProblem: string | null }[];
}

// Building ----------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function percent(passed: number, total: number): number | null {
  return total > 0 ? (passed / total) * 100 : null;
}

interface VersionItem {
  key: string;
  name: string;
  version: string | null;
  latest: string | null;
}

function pluginsOf(metadata: Json | null): { items: VersionItem[]; fromPlugin: boolean } {
  const list = Array.isArray(metadata?.plugins) ? (metadata.plugins as unknown[]).map(obj) : [];
  return {
    items: list.flatMap((p) => {
      const key = str(p.slug);
      return key ? [{ key, name: str(p.name) ?? key, version: str(p.version), latest: str(p.latest) }] : [];
    }),
    fromPlugin: list.length > 0 && list.every((p) => p.source === "plugin"),
  };
}

function themesOf(metadata: Json | null): VersionItem[] {
  const list = Array.isArray(obj(metadata?.plugin_report).themes) ? (obj(metadata?.plugin_report).themes as unknown[]).map(obj) : [];
  return list.flatMap((t) => {
    const key = str(t.slug);
    return key ? [{ key, name: str(t.name) ?? key, version: str(t.version), latest: str(t.latest) }] : [];
  });
}

/** Items whose version went up between the first and last check of the month. */
function updatesBetween(first: VersionItem[], last: VersionItem[]): { name: string; from: string; to: string }[] {
  const before = new Map(first.map((i) => [i.key, i]));
  return last.flatMap((after) => {
    const was = before.get(after.key);
    if (!was?.version || !after.version || compareVersions(after.version, was.version) <= 0) return [];
    return [{ name: after.name, from: was.version, to: after.version }];
  });
}

function wordpressWork(website: string, checks: ReportCheck[]): WordPressWork | null {
  const withData = checks.filter((c) => c.metadata && obj(c.metadata).wordpress);
  if (withData.length === 0) return null;
  const first = obj(withData[0].metadata);
  const last = obj(withData.at(-1)!.metadata);
  const lastPlugins = pluginsOf(last);
  // Compare plugins and themes with the earliest check that saw the same full list
  // (the site plugin's), not a check from before the plugin was installed.
  const baseline = lastPlugins.fromPlugin
    ? (withData.map((c) => obj(c.metadata)).find((m) => pluginsOf(m).fromPlugin) ?? first)
    : first;
  const firstPlugins = pluginsOf(baseline);
  const fromVersion = str(obj(first.wordpress).version);
  const toVersion = str(obj(last.wordpress).version);

  // PHP errors: each check reports the last 7 days, so keep the highest count seen per error.
  const errors = new Map<string, { source: string; count: number }>();
  for (const c of withData) {
    const fatal = obj(obj(c.metadata).plugin_report).fatal_errors;
    if (!Array.isArray(fatal)) continue;
    for (const raw of fatal.map(obj)) {
      const key = `${str(raw.first_at)}|${str(raw.file)}|${raw.line}|${str(raw.message)}`;
      const count = typeof raw.count === "number" ? raw.count : 1;
      const seen = errors.get(key);
      if (!seen || count > seen.count) errors.set(key, { source: str(raw.source) ?? "Unknown", count });
    }
  }
  const bySource = new Map<string, number>();
  for (const e of errors.values()) bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.count);

  const lastThemes = themesOf(last);
  const problems = (c: ReportCheck) => (Array.isArray(obj(c.metadata).problems) ? (obj(c.metadata).problems as unknown[]).map(obj) : []);
  return {
    website,
    core: fromVersion && toVersion && compareVersions(toVersion, fromVersion) > 0 ? { from: fromVersion, to: toVersion } : null,
    pluginUpdates: updatesBetween(firstPlugins.items, lastPlugins.items),
    themeUpdates: updatesBetween(themesOf(baseline), lastThemes),
    pendingUpdates:
      lastPlugins.items.filter((p) => p.version && p.latest && (lastPlugins.fromPlugin || compareVersions(p.version, p.latest) < 0)).length +
      lastThemes.filter((t) => t.latest).length,
    lastBackupAt: str(obj(last.wpengine).last_backup_at),
    backupProblems: withData.filter((c) => problems(c).some((p) => p.level === "critical" && /backup/i.test(String(p.message)))).length,
    phpErrors: [...bySource].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    fullDetail: firstPlugins.fromPlugin && lastPlugins.fromPlugin,
  };
}

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const { month, websites, monitors, uptime, checks, incidents } = input;
  const websiteName = new Map(websites.map((w) => [w.id, w]));
  const monitorById = new Map(monitors.map((m) => [m.id, m]));
  const checksFor = (monitorId: string) => checks.filter((c) => c.monitorId === monitorId);
  const siteOf = (m: ReportMonitor) => websiteName.get(m.websiteId);
  const label = (m: ReportMonitor) => {
    const w = siteOf(m);
    return w ? `${w.name}${w.environment === "production" ? "" : ` (${w.environment})`}` : m.name;
  };

  // Uptime: availability monitors only.
  const availability = uptime.filter((u) => {
    const m = monitorById.get(u.monitorId);
    return m && countsTowardUptime(m.type);
  });
  const total = availability.reduce((n, u) => n + u.checks, 0);
  const passed = availability.reduce((n, u) => n + u.passed, 0);
  const siteRows = websites.map((w) => {
    const rows = availability.filter((u) => monitorById.get(u.monitorId)?.websiteId === w.id);
    const checksRun = rows.reduce((n, u) => n + u.checks, 0);
    return {
      name: w.name,
      url: w.url,
      environment: w.environment,
      uptime: percent(rows.reduce((n, u) => n + u.passed, 0), checksRun),
      checks: checksRun,
    };
  });

  // Incidents in the month, oldest first.
  const incidentRows = [...incidents]
    .sort((a, b) => a.firstDetectedAt.localeCompare(b.firstDetectedAt))
    .map((i) => ({
      title: i.title,
      severity: i.severity,
      openedAt: i.firstDetectedAt,
      resolvedAt: i.resolvedAt,
      minutes: i.resolvedAt ? Math.max(0, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.firstDetectedAt)) / 60_000)) : null,
    }));
  const resolvedInMonth = incidentRows.filter(
    (i) => i.minutes !== null && i.resolvedAt && Date.parse(i.resolvedAt) >= month.start.getTime() && Date.parse(i.resolvedAt) < month.end.getTime(),
  );

  const byType = (type: MonitorType) => monitors.filter((m) => m.type === type);

  const pageSpeed = byType("page_speed").flatMap((m) => {
    const scored = checksFor(m.id).filter((c) => typeof obj(c.metadata).score === "number");
    if (scored.length === 0) return [];
    const scores = scored.map((c) => obj(c.metadata).score as number);
    const lastLab = obj(obj(scored.at(-1)!.metadata).lab);
    return [
      {
        website: label(m),
        url: siteOf(m)?.url ?? "",
        latest: scores.at(-1) ?? null,
        min: Math.min(...scores),
        max: Math.max(...scores),
        average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        tests: scores.length,
        latestLcpMs: typeof lastLab.lcpMs === "number" ? lastLab.lcpMs : null,
      },
    ];
  });

  const wordpress = byType("wordpress_health").flatMap((m) => {
    const work = wordpressWork(label(m), checksFor(m.id));
    return work ? [work] : [];
  });

  const latestMeta = (m: ReportMonitor) => {
    const withMeta = checksFor(m.id).filter((c) => c.metadata && Object.keys(c.metadata).length > 0);
    return withMeta.length ? obj(withMeta.at(-1)!.metadata) : null;
  };
  const ssl = byType("ssl_expiry").flatMap((m) => {
    const validTo = str(latestMeta(m)?.valid_to);
    return validTo ? [{ website: label(m), validTo }] : [];
  });
  const domains = [
    ...new Map(
      byType("domain_expiry").flatMap((m) => {
        const meta = latestMeta(m);
        const domain = str(meta?.domain);
        const expiresAt = str(meta?.expires_at);
        return domain && expiresAt ? [[domain, { domain, expiresAt, registrar: str(meta?.registrar) }] as const] : [];
      }),
    ).values(),
  ];
  const visibility = byType("search_visibility").flatMap((m) => {
    const all = checksFor(m.id);
    if (all.length === 0) return [];
    const bad = all.filter((c) => !c.passed);
    return [{ website: label(m), checks: all.length, problems: bad.length, latestProblem: bad.at(-1)?.errorMessage ?? null }];
  });

  return {
    month,
    inProgress: input.now.getTime() < month.end.getTime(),
    overview: {
      uptime: percent(passed, total),
      checks: total,
      incidents: incidentRows.filter((i) => Date.parse(i.openedAt) >= month.start.getTime()).length,
      meanMinutesToResolve: resolvedInMonth.length
        ? Math.round(resolvedInMonth.reduce((n, i) => n + (i.minutes ?? 0), 0) / resolvedInMonth.length)
        : null,
    },
    websites: siteRows,
    incidents: incidentRows,
    pageSpeed,
    wordpress,
    ssl,
    domains,
    visibility,
  };
}
