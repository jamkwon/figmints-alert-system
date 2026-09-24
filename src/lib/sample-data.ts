// SAMPLE data used when Supabase is not configured. Fictional clients on the
// reserved .example domain. Mirrors supabase/seed.sql; keep the two in sync.
import type {
  AssignedTeam,
  CheckResult,
  CheckStatus,
  Client,
  Environment,
  Incident,
  IncidentEvent,
  IncidentStatus,
  Monitor,
  MonitorCheckSummary,
  MonitorUptime,
  MonitorType,
  Severity,
  Snapshot,
  Website,
} from "@/lib/types";

const cid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const wid = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const mid = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const iid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

/** Latest check and last success for one monitor, like the monitor_check_summary view. */
export function summarizeChecks(monitorId: string, checks: CheckResult[]): MonitorCheckSummary {
  const own = checks
    .filter((c) => c.monitor_id === monitorId)
    .sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const latest = own[0];
  return {
    monitor_id: monitorId,
    last_status: latest?.status ?? null,
    last_result_at: latest?.checked_at ?? null,
    last_http_status: latest?.http_status ?? null,
    last_response_time_ms: latest?.response_time_ms ?? null,
    last_error_message: latest?.error_message ?? null,
    last_success_at: own.find((c) => c.passed)?.checked_at ?? null,
  };
}

/** Same numbers as the monitor_uptime view. */
export function computeUptime(monitorId: string, checks: CheckResult[], now: Date): MonitorUptime {
  const since = (hours: number) => now.getTime() - hours * 3_600_000;
  const own = checks.filter((c) => c.monitor_id === monitorId);
  const window = (hours: number) => own.filter((c) => new Date(c.checked_at).getTime() > since(hours));
  const count = (list: CheckResult[]) => [list.length, list.filter((c) => c.passed).length] as const;
  const [checks_24h, passed_24h] = count(window(24));
  const [checks_7d, passed_7d] = count(window(24 * 7));
  const [checks_30d, passed_30d] = count(window(24 * 30));
  return { monitor_id: monitorId, checks_24h, passed_24h, checks_7d, passed_7d, checks_30d, passed_30d };
}

export function buildSampleData(now: Date = new Date()): {
  snapshot: Snapshot;
  checkResults: CheckResult[];
  events: IncidentEvent[];
} {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const created = ago(60 * 24 * 90);

  const client = (n: number, name: string, url: string, active: boolean, notes: string): Client => ({
    id: cid(n),
    name,
    primary_website: url,
    active,
    notes,
    created_at: created,
    updated_at: created,
  });

  const clients: Client[] = [
    client(1, "Harborview Dental (Sample)", "https://harborviewdental.example", true,
      "Lead generation site. Appointment requests come through the Contact page."),
    client(2, "Northgate Title Co. (Sample)", "https://northgatetitle.example", true,
      "Hosting plan is on the small side; watch response times during business hours."),
    client(3, "Blue Finch Bakery (Sample)", "https://bluefinchbakery.example", true,
      "Ecommerce: online orders for pickup. Shop page is business-critical."),
    client(4, "Summit Ridge Academy (Sample)", "https://summitridgeacademy.example", true,
      "Admissions season runs October through January."),
    client(5, "Coastal Roofing Pros (Sample)", "https://coastalroofingpros.example", true,
      "Free estimate form is the main lead source."),
    client(6, "Maple & Oak Law (Sample)", "https://mapleoaklaw.example", false,
      "Contract paused. Monitoring disabled."),
  ];

  const website = (n: number, clientN: number, name: string, url: string, environment: Environment): Website => ({
    id: wid(n),
    client_id: cid(clientN),
    name,
    url,
    environment,
    active: true,
    maintenance_until: null,
    maintenance_note: "",
    created_at: created,
    updated_at: created,
  });

  const websites: Website[] = [
    website(1, 1, "Main site", "https://harborviewdental.example", "production"),
    website(2, 2, "Main site", "https://northgatetitle.example", "production"),
    website(3, 3, "Main site", "https://bluefinchbakery.example", "production"),
    website(4, 4, "Main site", "https://summitridgeacademy.example", "production"),
    website(5, 4, "Staging", "https://staging.summitridgeacademy.example", "staging"),
    website(6, 5, "Main site", "https://coastalroofingpros.example", "production"),
    website(7, 6, "Main site", "https://mapleoaklaw.example", "production"),
  ];
  // Staging is mid-rebuild: in a maintenance window for the next 2 days.
  websites[4].maintenance_until = ago(-60 * 24 * 2);
  websites[4].maintenance_note = "Planned rebuild";

  const monitors: Monitor[] = [];
  const checkResults: CheckResult[] = [];

  interface SampleFailure {
    min: number;
    status: Exclude<CheckStatus, "passed">;
    http: number;
    ms: number;
    error: string;
  }

  // Mirrors seed.sql: 12 passing checks ending `passingLatestMin` ago, then any failures.
  function monitor(
    n: number,
    websiteN: number,
    name: string,
    type: MonitorType,
    url: string,
    opts: {
      expectedText?: string;
      maxMs?: number;
      interval: number;
      severity: Severity;
      active?: boolean;
      passingLatestMin: number;
      failures?: SampleFailure[];
    },
  ) {
    const id = mid(n);
    for (let g = 0; g < 12; g++) {
      checkResults.push({
        id: `${id}-p${g}`,
        monitor_id: id,
        status: "passed",
        checked_at: ago(opts.passingLatestMin + g * opts.interval),
        http_status: 200,
        response_time_ms: type === "response_time" ? 1100 + ((g * 53) % 300) : 280 + ((g * 37) % 400),
        passed: true,
        error_message: null,
        metadata: {},
      });
    }
    for (const [i, f] of (opts.failures ?? []).entries()) {
      checkResults.push({
        id: `${id}-f${i}`,
        monitor_id: id,
        status: f.status,
        checked_at: ago(f.min),
        http_status: f.http,
        response_time_ms: f.ms,
        passed: false,
        error_message: f.error,
        metadata: {},
      });
    }
    const lastMin = Math.min(opts.passingLatestMin, ...(opts.failures ?? []).map((f) => f.min));
    monitors.push({
      id,
      website_id: wid(websiteN),
      name,
      monitor_type: type,
      target_url: url,
      expected_status_code: null,
      expected_text: opts.expectedText ?? null,
      max_response_time_ms: opts.maxMs ?? null,
      interval_minutes: opts.interval,
      severity_on_failure: opts.severity,
      active: opts.active ?? true,
      last_checked_at: ago(lastMin),
      next_check_at: ago(lastMin - opts.interval),
      created_at: created,
      updated_at: created,
    });
  }

  const fails = (
    status: SampleFailure["status"],
    http: number,
    error: string,
    points: [min: number, ms: number][],
  ): SampleFailure[] => points.map(([min, ms]) => ({ min, status, http, ms, error }));

  monitor(1, 1, "Homepage", "http_status", "https://harborviewdental.example/",
    { interval: 5, severity: "critical", passingLatestMin: 1 });
  monitor(2, 1, "Contact Page", "expected_content", "https://harborviewdental.example/contact",
    { expectedText: "Request an Appointment", interval: 5, severity: "critical", passingLatestMin: 18,
      failures: fails("failed", 500, "HTTP 500 Internal Server Error", [[13, 612], [8, 587], [3, 640]]) });
  monitor(3, 1, "Services Page", "http_status", "https://harborviewdental.example/services",
    { interval: 15, severity: "warning", passingLatestMin: 6 });
  monitor(4, 2, "Homepage Response Time", "response_time", "https://northgatetitle.example/",
    { maxMs: 2000, interval: 15, severity: "warning", passingLatestMin: 64,
      failures: [[49, 3600], [34, 4100], [19, 3900], [4, 4400]].map(([min, ms]) => ({
        min, status: "warning" as const, http: 200, ms, error: `Response time ${ms} ms exceeds 2000 ms threshold`,
      })) });
  monitor(5, 2, "Contact Page", "http_status", "https://northgatetitle.example/contact",
    { interval: 15, severity: "critical", passingLatestMin: 9 });
  monitor(6, 3, "Homepage", "http_status", "https://bluefinchbakery.example/",
    { interval: 5, severity: "critical", passingLatestMin: 2 });
  monitor(7, 3, "Shop Page", "expected_content", "https://bluefinchbakery.example/shop",
    { expectedText: "Add to cart", interval: 15, severity: "critical", passingLatestMin: 11 });
  monitor(8, 4, "Homepage", "http_status", "https://summitridgeacademy.example/",
    { interval: 15, severity: "critical", passingLatestMin: 5 });
  monitor(9, 4, "Admissions Page", "expected_content", "https://summitridgeacademy.example/admissions",
    { expectedText: "Schedule a Visit", interval: 60, severity: "critical", passingLatestMin: 23 });
  monitor(10, 5, "Staging Homepage", "http_status", "https://staging.summitridgeacademy.example/",
    { interval: 60, severity: "informational", passingLatestMin: 2880,
      failures: fails("failed", 503, "HTTP 503 Service Unavailable", [[14, 95]]) });
  monitor(11, 6, "Homepage", "http_status", "https://coastalroofingpros.example/",
    { interval: 5, severity: "critical", passingLatestMin: 3 });
  monitor(12, 6, "Free Estimate Page", "expected_content", "https://coastalroofingpros.example/free-estimate",
    { expectedText: "Get Your Free Estimate", interval: 15, severity: "warning", passingLatestMin: 68,
      failures: fails("failed", 200, 'Expected text "Get Your Free Estimate" not found',
        [[53, 820], [38, 790], [23, 845], [8, 801]]) });
  monitor(13, 7, "Homepage", "http_status", "https://mapleoaklaw.example/",
    { interval: 60, severity: "critical", active: false, passingLatestMin: 17280 });

  checkResults.sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  const summaries = monitors.map((m) => summarizeChecks(m.id, checkResults));

  function incident(
    n: number,
    clientN: number,
    websiteN: number,
    monitorN: number,
    title: string,
    description: string,
    severity: Severity,
    status: IncidentStatus,
    firstMin: number,
    lastMin: number,
    resolvedMin: number | null,
    team: AssignedTeam,
    notes = "",
  ): Incident {
    return {
      id: iid(n),
      client_id: cid(clientN),
      website_id: wid(websiteN),
      monitor_id: mid(monitorN),
      title,
      description,
      severity,
      status,
      first_detected_at: ago(firstMin),
      last_detected_at: ago(lastMin),
      resolved_at: resolvedMin === null ? null : ago(resolvedMin),
      assigned_team: team,
      internal_notes: notes,
      snoozed_until: null,
      created_at: ago(firstMin),
      updated_at: ago(lastMin),
    };
  }

  const incidents: Incident[] = [
    incident(1, 1, 1, 2, "Contact page is unavailable",
      "Failed 3 consecutive checks. /contact is returning HTTP 500 Internal Server Error.",
      "critical", "open", 13, 3, null, "development"),
    incident(2, 2, 2, 4, "Homepage response time significantly above normal",
      "Last 4 checks averaged 4.0 s against a 2.0 s threshold. Normal is about 1.2 s.",
      "warning", "open", 49, 4, null, "unassigned"),
    incident(3, 5, 6, 12, "Expected content missing on Free Estimate page",
      'Page returns HTTP 200 but "Get Your Free Estimate" was not found. Failed 4 consecutive checks.',
      "warning", "investigating", 53, 8, null, "development",
      "Theme update deployed this morning. Checking whether the heading changed or the form block is missing."),
    incident(4, 4, 5, 10, "Staging site offline for planned rebuild",
      "Staging returns HTTP 503 during the scheduled rebuild.",
      "informational", "expected_maintenance", 2820, 14, null, "development",
      "Rebuild expected to finish Friday."),
    incident(5, 3, 3, 7, "Shop page returned 502 Bad Gateway",
      "Failed 3 consecutive checks. /shop returned HTTP 502.",
      "critical", "resolved", 4380, 4350, 4320, "development",
      "Host restarted PHP workers; shop recovered."),
    incident(6, 2, 2, 5, "Contact page returned 404 after menu update",
      "Failed 2 consecutive checks. /contact returned HTTP 404.",
      "critical", "resolved", 8640, 8625, 8595, "account_management",
      "Page slug changed during a content update. Redirect added."),
  ];

  const uptime = monitors.map((m) => computeUptime(m.id, checkResults, now));

  // A short history per incident: opened by the engine, plus a few staff actions.
  const events: IncidentEvent[] = [];
  const event = (incident: Incident, minAgo: number, actor: string, kind: IncidentEvent["kind"], message: string) =>
    events.push({ id: `${incident.id}-e${events.length}`, incident_id: incident.id, created_at: ago(minAgo), actor, kind, message });
  for (const i of incidents) {
    const openedMin = (now.getTime() - new Date(i.first_detected_at).getTime()) / 60_000;
    event(i, openedMin, "system", "opened", `Opened after 2 consecutive failed checks (${i.severity})`);
  }
  event(incidents[2], 40, "alex@figmints.com", "status_changed", "Marked Investigating");
  event(incidents[2], 39, "alex@figmints.com", "assigned", "Assigned to Development");
  event(incidents[2], 30, "alex@figmints.com", "notes_updated", "Updated internal notes");
  event(incidents[3], 2800, "sam@figmints.com", "status_changed", "Marked Expected Maintenance");
  event(incidents[4], 4320, "system", "resolved", "Resolved automatically after 2 successful checks");
  event(incidents[5], 8595, "jordan@figmints.com", "resolved", "Resolved");
  events.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { snapshot: { clients, websites, monitors, summaries, incidents, uptime }, checkResults, events };
}
