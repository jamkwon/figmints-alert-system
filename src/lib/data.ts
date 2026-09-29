import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import {
  compareHealth,
  isActiveIncident,
  isUnresolvedIncident,
  monitorHealth,
  needsAttention,
  rollUpHealth,
  type Health,
} from "@/lib/health";
import { requireStaff } from "@/lib/auth/session";
import { countsTowardUptime } from "@/lib/labels";
import { APP_TIMEZONE } from "@/lib/format";
import type { ReportInput, ReportMonth } from "@/lib/report";
import { countByDay, type DayCount } from "@/lib/uptime-history";
import { buildSampleData } from "@/lib/sample-data";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import type {
  CheckResult,
  IncidentEvent,
  MonitorUptime,
  Client,
  Incident,
  Monitor,
  MonitorCheckSummary,
  Severity,
  Snapshot,
  Website,
} from "@/lib/types";

// Phase 1 loads the whole (small) dataset per request and derives views in code.
// Fine for tens of clients; revisit with targeted queries if it grows.
const INCIDENT_LIMIT = 500;

export type DataSource = "supabase" | "sample";

export function getDataSource(): DataSource {
  return isSupabaseConfigured() ? "supabase" : "sample";
}

// One sample dataset per request so the snapshot and check history line up.
const loadSampleData = cache(() => buildSampleData());

const loadSnapshot = cache(async (): Promise<Snapshot> => {
  await connection();
  if (!isSupabaseConfigured()) return loadSampleData().snapshot;

  const db = getSupabase();
  const [clients, websites, monitors, summaries, incidents, uptime] = await Promise.all([
    db.from("clients").select("*").order("name"),
    db.from("websites").select("*").order("name"),
    db.from("monitors").select("*").order("name"),
    db.from("monitor_check_summary").select("*"),
    db
      .from("incidents")
      .select("*")
      .order("first_detected_at", { ascending: false })
      .limit(INCIDENT_LIMIT),
    db.from("monitor_uptime").select("*"),
  ]);

  for (const [table, result] of Object.entries({ clients, websites, monitors, summaries, incidents, uptime })) {
    if (result.error) throw new Error(`Failed to load ${table}: ${result.error.message}`);
  }

  return {
    clients: clients.data as Client[],
    websites: websites.data as Website[],
    monitors: monitors.data as Monitor[],
    summaries: summaries.data as MonitorCheckSummary[],
    incidents: incidents.data as Incident[],
    // Postgres count() arrives as a string over the API; normalize to numbers.
    uptime: (uptime.data as Record<string, string | number>[]).map((row) => ({
      monitor_id: String(row.monitor_id),
      checks_24h: Number(row.checks_24h),
      passed_24h: Number(row.passed_24h),
      checks_7d: Number(row.checks_7d),
      passed_7d: Number(row.passed_7d),
      checks_30d: Number(row.checks_30d),
      passed_30d: Number(row.passed_30d),
    })),
  };
});

// View models ------------------------------------------------------------------

export interface MonitorView {
  monitor: Monitor;
  website: Website;
  client: Client;
  summary: MonitorCheckSummary | undefined;
  health: Health;
  activeIncident: Incident | undefined;
  /** Any not-yet-resolved incident, including ignored ones. */
  unresolvedIncident: Incident | undefined;
  uptime: MonitorUptime | undefined;
}

export interface WebsiteView {
  website: Website;
  health: Health;
}

export interface IncidentView {
  incident: Incident;
  client: Client;
  website: Website | undefined;
  monitor: Monitor | undefined;
}

export interface ClientView {
  client: Client;
  health: Health;
  websites: WebsiteView[];
  monitors: MonitorView[];
  incidents: IncidentView[];
  activeIncidents: IncidentView[];
  lastCheckedAt: string | null;
  /** Passing checks / all checks over 7 days, across the client's active monitors. */
  uptime7d: { passed: number; checks: number };
}

export interface AppData {
  source: DataSource;
  loadedAt: string;
  clients: ClientView[];
  monitors: MonitorView[];
  incidents: IncidentView[];
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, informational: 2 };

function latest(dates: (string | null)[]): string | null {
  return dates.reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null);
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

/** Active incidents first (by severity), then most recent. */
export function compareIncidents(a: IncidentView, b: IncidentView): number {
  const activeDiff = Number(isActiveIncident(b.incident)) - Number(isActiveIncident(a.incident));
  if (activeDiff !== 0) return activeDiff;
  const attentionDiff = Number(needsAttention(b.incident)) - Number(needsAttention(a.incident));
  if (attentionDiff !== 0) return attentionDiff;
  const severityDiff = SEVERITY_ORDER[a.incident.severity] - SEVERITY_ORDER[b.incident.severity];
  if (severityDiff !== 0) return severityDiff;
  return b.incident.first_detected_at.localeCompare(a.incident.first_detected_at);
}

function buildAppData(s: Snapshot): Omit<AppData, "source" | "loadedAt"> {
  const clientById = new Map(s.clients.map((c) => [c.id, c]));
  const websiteById = new Map(s.websites.map((w) => [w.id, w]));
  const monitorById = new Map(s.monitors.map((m) => [m.id, m]));
  const summaryByMonitor = new Map(s.summaries.map((x) => [x.monitor_id, x]));
  const uptimeByMonitor = new Map(s.uptime.map((x) => [x.monitor_id, x]));
  const incidentsByMonitor = groupBy(s.incidents, (i) => i.monitor_id);

  const monitors: MonitorView[] = [];
  for (const monitor of s.monitors) {
    const website = websiteById.get(monitor.website_id);
    const client = website && clientById.get(website.client_id);
    if (!website || !client) continue;
    const monitorIncidents = incidentsByMonitor.get(monitor.id) ?? [];
    monitors.push({
      monitor,
      website,
      client,
      summary: summaryByMonitor.get(monitor.id),
      health: monitorHealth(
        monitor,
        summaryByMonitor.get(monitor.id),
        monitorIncidents,
        website.active && client.active,
      ),
      activeIncident: monitorIncidents.find(isActiveIncident),
      unresolvedIncident: monitorIncidents.find(isUnresolvedIncident),
      uptime: uptimeByMonitor.get(monitor.id),
    });
  }

  const incidents: IncidentView[] = s.incidents
    .filter((incident) => clientById.has(incident.client_id))
    .map((incident) => ({
      incident,
      client: clientById.get(incident.client_id)!,
      website: incident.website_id ? websiteById.get(incident.website_id) : undefined,
      monitor: incident.monitor_id ? monitorById.get(incident.monitor_id) : undefined,
    }))
    .sort(compareIncidents);

  const monitorsByWebsite = groupBy(monitors, (m) => m.website.id);
  const monitorsByClient = groupBy(monitors, (m) => m.client.id);
  const incidentsByClient = groupBy(incidents, (i) => i.client.id);
  const incidentsByWebsite = groupBy(incidents, (i) => i.incident.website_id);

  const clients: ClientView[] = s.clients
    .map((client) => {
      const clientMonitors = monitorsByClient.get(client.id) ?? [];
      const clientIncidents = incidentsByClient.get(client.id) ?? [];
      const websites = s.websites
        .filter((w) => w.client_id === client.id)
        .map((website) => ({
          website,
          health: rollUpHealth(
            website.active && client.active,
            (monitorsByWebsite.get(website.id) ?? []).map((m) => m.health),
            (incidentsByWebsite.get(website.id) ?? []).map((i) => i.incident),
          ),
        }));
      return {
        client,
        health: rollUpHealth(
          client.active,
          clientMonitors.map((m) => m.health),
          clientIncidents.map((i) => i.incident),
        ),
        websites,
        monitors: clientMonitors,
        incidents: clientIncidents,
        activeIncidents: clientIncidents.filter((i) => isActiveIncident(i.incident)),
        lastCheckedAt: latest(clientMonitors.map((m) => m.monitor.last_checked_at)),
        // SSL and link scans aren't availability checks, so they don't count toward uptime.
        uptime7d: clientMonitors
          .filter((m) => m.monitor.active && countsTowardUptime(m.monitor.monitor_type))
          .reduce(
            (sum, m) => ({ passed: sum.passed + (m.uptime?.passed_7d ?? 0), checks: sum.checks + (m.uptime?.checks_7d ?? 0) }),
            { passed: 0, checks: 0 },
          ),
      };
    })
    .sort((a, b) => compareHealth(a.health, b.health) || a.client.name.localeCompare(b.client.name));

  return { clients, monitors, incidents };
}

export const getAppData = cache(async (): Promise<AppData> => {
  // Data access layer: every read of client data is behind the staff check.
  await requireStaff();
  const snapshot = await loadSnapshot();
  return {
    source: getDataSource(),
    loadedAt: new Date().toISOString(),
    ...buildAppData(snapshot),
  };
});

/**
 * The same view models without the staff check, for scheduled jobs that are
 * already authenticated by CRON_SECRET (the weekly summary). Pages and actions
 * must use getAppData.
 */
export async function loadSystemAppData(): Promise<Omit<AppData, "source" | "loadedAt">> {
  return buildAppData(await loadSnapshot());
}

/** When the last weekly summary went out; null if never, or before its migration ran. */
export async function getLastWeeklySummary(): Promise<string | null> {
  await requireStaff();
  await connection();
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase()
    .from("weekly_summaries")
    .select("sent_at")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? null : ((data?.sent_at as string | undefined) ?? null);
}

/** Most recent checks for one monitor, newest first. */
export async function getCheckHistory(monitorId: string, limit = 50): Promise<CheckResult[]> {
  await requireStaff();
  await connection();
  if (!isSupabaseConfigured()) {
    return loadSampleData()
      .checkResults.filter((c) => c.monitor_id === monitorId)
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("check_results")
    .select("*")
    .eq("monitor_id", monitorId)
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load check history: ${error.message}`);
  return data as CheckResult[];
}

// Matches the scheduler's grace window in claim_due_monitors.
const DUE_GRACE_MS = 60_000;

export interface SchedulerStatus {
  dueNow: number;
  nextDue: string | null;
  lastCheck: string | null;
}

/** When the scheduler will next have work, based on monitors' next_check_at. */
export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const { monitors } = await getAppData();
  const running = monitors.filter((m) => m.health !== "inactive");
  const dueCutoff = Date.now() + DUE_GRACE_MS;
  const isDue = (next: string | null) => !next || new Date(next).getTime() <= dueCutoff;
  const upcoming = running
    .map((m) => m.monitor.next_check_at)
    .filter((d): d is string => !isDue(d))
    .sort();
  const checked = running
    .map((m) => m.monitor.last_checked_at)
    .filter((d): d is string => d !== null)
    .sort();
  return {
    dueNow: running.filter((m) => isDue(m.monitor.next_check_at)).length,
    nextDue: upcoming[0] ?? null,
    lastCheck: checked.at(-1) ?? null,
  };
}

/** Incident history, newest first. */
export async function getIncidentEvents(incidentId: string): Promise<IncidentEvent[]> {
  await requireStaff();
  await connection();
  if (!isSupabaseConfigured()) {
    return loadSampleData().events.filter((e) => e.incident_id === incidentId);
  }
  const { data, error } = await getSupabase()
    .from("incident_events")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to load incident history: ${error.message}`);
  return data as IncidentEvent[];
}

// Monthly report ----------------------------------------------------------------------

/**
 * Everything the monthly report needs for one client and month, or null for an
 * unknown client. Availability monitors are counted in the database (they check
 * every few minutes); other checks are few enough to load.
 */
export async function getReportInput(clientId: string, month: ReportMonth): Promise<{ client: Client; input: ReportInput } | null> {
  await requireStaff();
  await connection();
  return loadReportInput(clientId, month);
}

/**
 * The report data without the staff check, for the scheduled monthly posting
 * (already authenticated by CRON_SECRET). Pages must use getReportInput.
 */
export async function loadReportInput(clientId: string, month: ReportMonth): Promise<{ client: Client; input: ReportInput } | null> {
  const start = month.start.toISOString();
  const end = month.end.toISOString();
  const inMonth = (iso: string) => iso >= start && iso < end;
  const toMonitor = (m: Monitor) => ({ id: m.id, websiteId: m.website_id, name: m.name, type: m.monitor_type });
  const toWebsite = (w: Website) => ({ id: w.id, name: w.name, url: w.url, environment: w.environment });
  const toIncident = (i: Incident) => ({
    title: i.title,
    severity: i.severity,
    firstDetectedAt: i.first_detected_at,
    resolvedAt: i.resolved_at,
  });
  const openInMonth = (i: Incident) => i.first_detected_at < end && (!i.resolved_at || i.resolved_at >= start);

  if (!isSupabaseConfigured()) {
    const { snapshot, checkResults } = loadSampleData();
    const client = snapshot.clients.find((c) => c.id === clientId);
    if (!client) return null;
    const websites = snapshot.websites.filter((w) => w.client_id === clientId);
    const monitors = snapshot.monitors.filter((m) => websites.some((w) => w.id === m.website_id));
    const checks = checkResults.filter((c) => monitors.some((m) => m.id === c.monitor_id) && inMonth(c.checked_at));
    const availability = monitors.filter((m) => countsTowardUptime(m.monitor_type));
    return {
      client,
      input: {
        month,
        now: new Date(),
        websites: websites.map(toWebsite),
        monitors: monitors.map(toMonitor),
        uptime: availability.map((m) => {
          const own = checks.filter((c) => c.monitor_id === m.id);
          return { monitorId: m.id, checks: own.length, passed: own.filter((c) => c.passed).length };
        }),
        checks: checks
          .filter((c) => !availability.some((m) => m.id === c.monitor_id))
          .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
          .map((c) => ({ monitorId: c.monitor_id, checkedAt: c.checked_at, status: c.status, passed: c.passed, errorMessage: c.error_message, metadata: c.metadata })),
        incidents: snapshot.incidents.filter((i) => i.client_id === clientId && openInMonth(i)).map(toIncident),
        daily: availability.flatMap((m) =>
          countByDay(checks.filter((c) => c.monitor_id === m.id), APP_TIMEZONE).map((d) => ({ monitorId: m.id, ...d })),
        ),
      },
    };
  }

  const db = getSupabase();
  const client = await db.from("clients").select("*").eq("id", clientId).maybeSingle();
  if (client.error) throw new Error(`Failed to load client: ${client.error.message}`);
  if (!client.data) return null;
  const websites = await db.from("websites").select("*").eq("client_id", clientId).order("name");
  if (websites.error) throw new Error(`Failed to load websites: ${websites.error.message}`);
  const websiteIds = (websites.data as Website[]).map((w) => w.id);
  const monitors = websiteIds.length
    ? await db.from("monitors").select("*").in("website_id", websiteIds)
    : { data: [] as Monitor[], error: null };
  if (monitors.error) throw new Error(`Failed to load monitors: ${monitors.error.message}`);
  const all = monitors.data as Monitor[];
  const availability = all.filter((m) => countsTowardUptime(m.monitor_type));
  const others = all.filter((m) => !countsTowardUptime(m.monitor_type));

  const count = async (monitorId: string, passedOnly: boolean) => {
    let q = db
      .from("check_results")
      .select("id", { count: "exact", head: true })
      .eq("monitor_id", monitorId)
      .gte("checked_at", start)
      .lt("checked_at", end);
    if (passedOnly) q = q.eq("passed", true);
    const { count: n, error } = await q;
    if (error) throw new Error(`Failed to count checks: ${error.message}`);
    return n ?? 0;
  };
  const [uptime, checks, incidents, daily] = await Promise.all([
    Promise.all(availability.map(async (m) => ({ monitorId: m.id, checks: await count(m.id, false), passed: await count(m.id, true) }))),
    others.length
      ? db
          .from("check_results")
          .select("monitor_id, checked_at, status, passed, error_message, metadata")
          .in("monitor_id", others.map((m) => m.id))
          .gte("checked_at", start)
          .lt("checked_at", end)
          .order("checked_at", { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("incidents")
      .select("*")
      .eq("client_id", clientId)
      .lt("first_detected_at", end)
      .or(`resolved_at.is.null,resolved_at.gte.${start}`),
    dailyCounts(availability.map((m) => m.id), month.start),
  ]);
  if (checks.error) throw new Error(`Failed to load checks: ${checks.error.message}`);
  if (incidents.error) throw new Error(`Failed to load incidents: ${incidents.error.message}`);
  return {
    client: client.data as Client,
    input: {
      month,
      now: new Date(),
      websites: (websites.data as Website[]).map(toWebsite),
      monitors: all.map(toMonitor),
      uptime,
      checks: (checks.data as CheckResult[]).map((c) => ({
        monitorId: c.monitor_id,
        checkedAt: c.checked_at,
        status: c.status,
        passed: c.passed,
        errorMessage: c.error_message,
        metadata: c.metadata,
      })),
      incidents: (incidents.data as Incident[]).map(toIncident),
      daily: [...daily].flatMap(([monitorId, days]) =>
        days.filter((d) => d.day.startsWith(month.key)).map((d) => ({ monitorId, ...d })),
      ),
    },
  };
}

// Trends --------------------------------------------------------------------------

export interface ScorePoint {
  checkedAt: string;
  score: number;
  lcpMs: number | null;
}

/** A page speed monitor's scores over the last `days` days, oldest first. */
export async function getScoreHistory(monitorId: string, days = 90): Promise<ScorePoint[]> {
  await requireStaff();
  await connection();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const toPoint = (checkedAt: string, meta: Record<string, unknown> | null): ScorePoint[] => {
    const score = meta?.score;
    const lab = meta?.lab as { lcpMs?: unknown } | undefined;
    return typeof score === "number" ? [{ checkedAt, score, lcpMs: typeof lab?.lcpMs === "number" ? lab.lcpMs : null }] : [];
  };
  if (!isSupabaseConfigured()) {
    return loadSampleData()
      .checkResults.filter((c) => c.monitor_id === monitorId && c.checked_at >= since)
      .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
      .flatMap((c) => toPoint(c.checked_at, c.metadata));
  }
  const { data, error } = await getSupabase()
    .from("check_results")
    .select("checked_at, metadata")
    .eq("monitor_id", monitorId)
    .gte("checked_at", since)
    .order("checked_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Failed to load score history: ${error.message}`);
  return (data as { checked_at: string; metadata: Record<string, unknown> | null }[]).flatMap((c) => toPoint(c.checked_at, c.metadata));
}

/** Checks and passes per monitor per local day since `since`, counted in the database. */
async function dailyCounts(monitorIds: string[], since: Date): Promise<Map<string, DayCount[]>> {
  const result = new Map<string, DayCount[]>();
  if (monitorIds.length === 0) return result;
  if (!isSupabaseConfigured()) {
    const from = since.toISOString();
    const checks = loadSampleData().checkResults.filter((c) => monitorIds.includes(c.monitor_id) && c.checked_at >= from);
    for (const id of monitorIds) result.set(id, countByDay(checks.filter((c) => c.monitor_id === id), APP_TIMEZONE));
    return result;
  }
  const { data, error } = await getSupabase().rpc("daily_uptime", {
    monitor_ids: monitorIds,
    since: since.toISOString(),
    tz: APP_TIMEZONE,
  });
  // Before the migration runs, history just shows empty.
  if (error) {
    console.warn("[uptime history] unavailable:", error.message);
    return result;
  }
  for (const row of data as { monitor_id: string; day: string; checks: number | string; passed: number | string }[]) {
    const list = result.get(row.monitor_id) ?? [];
    list.push({ day: String(row.day).slice(0, 10), checks: Number(row.checks), passed: Number(row.passed) });
    result.set(row.monitor_id, list);
  }
  return result;
}

/** Per-day counts for the uptime history bars (last `days` days). */
export async function getDailyUptime(monitorIds: string[], days = 90): Promise<Map<string, DayCount[]>> {
  await requireStaff();
  await connection();
  return dailyCounts(monitorIds, new Date(Date.now() - (days + 1) * 86_400_000));
}
