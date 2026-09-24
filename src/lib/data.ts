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
