// SAMPLE data used when Supabase is not configured. Fictional clients on the
// reserved .example domain. Mirrors supabase/seed.sql; keep the two in sync.
import type {
  AssignedTeam,
  CheckStatus,
  Client,
  Environment,
  Incident,
  IncidentStatus,
  Monitor,
  MonitorCheckSummary,
  MonitorType,
  Severity,
  Snapshot,
  Website,
} from "@/lib/types";

const cid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const wid = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const mid = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const iid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

export function buildSampleSnapshot(now: Date = new Date()): Snapshot {
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

  const monitors: Monitor[] = [];
  const summaries: MonitorCheckSummary[] = [];

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
      lastMin: number;
      lastSuccessMin: number;
      last: { status: CheckStatus; http: number; ms: number; error?: string };
    },
  ) {
    monitors.push({
      id: mid(n),
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
      last_checked_at: ago(opts.lastMin),
      next_check_at: ago(opts.lastMin - opts.interval),
      created_at: created,
      updated_at: created,
    });
    summaries.push({
      monitor_id: mid(n),
      last_status: opts.last.status,
      last_result_at: ago(opts.lastMin),
      last_http_status: opts.last.http,
      last_response_time_ms: opts.last.ms,
      last_error_message: opts.last.error ?? null,
      last_success_at: ago(opts.lastSuccessMin),
    });
  }

  const ok = (ms: number) => ({ status: "passed" as const, http: 200, ms });

  monitor(1, 1, "Homepage", "http_status", "https://harborviewdental.example/",
    { interval: 5, severity: "critical", lastMin: 1, lastSuccessMin: 1, last: ok(280) });
  monitor(2, 1, "Contact Page", "expected_content", "https://harborviewdental.example/contact",
    { expectedText: "Request an Appointment", interval: 5, severity: "critical", lastMin: 3, lastSuccessMin: 18,
      last: { status: "failed", http: 500, ms: 640, error: "HTTP 500 Internal Server Error" } });
  monitor(3, 1, "Services Page", "http_status", "https://harborviewdental.example/services",
    { interval: 15, severity: "warning", lastMin: 6, lastSuccessMin: 6, last: ok(280) });
  monitor(4, 2, "Homepage Response Time", "response_time", "https://northgatetitle.example/",
    { maxMs: 2000, interval: 15, severity: "warning", lastMin: 4, lastSuccessMin: 64,
      last: { status: "warning", http: 200, ms: 4400, error: "Response time 4400 ms exceeds 2000 ms threshold" } });
  monitor(5, 2, "Contact Page", "http_status", "https://northgatetitle.example/contact",
    { interval: 15, severity: "critical", lastMin: 9, lastSuccessMin: 9, last: ok(280) });
  monitor(6, 3, "Homepage", "http_status", "https://bluefinchbakery.example/",
    { interval: 5, severity: "critical", lastMin: 2, lastSuccessMin: 2, last: ok(280) });
  monitor(7, 3, "Shop Page", "expected_content", "https://bluefinchbakery.example/shop",
    { expectedText: "Add to cart", interval: 15, severity: "critical", lastMin: 11, lastSuccessMin: 11, last: ok(280) });
  monitor(8, 4, "Homepage", "http_status", "https://summitridgeacademy.example/",
    { interval: 15, severity: "critical", lastMin: 5, lastSuccessMin: 5, last: ok(280) });
  monitor(9, 4, "Admissions Page", "expected_content", "https://summitridgeacademy.example/admissions",
    { expectedText: "Schedule a Visit", interval: 60, severity: "critical", lastMin: 23, lastSuccessMin: 23, last: ok(280) });
  monitor(10, 5, "Staging Homepage", "http_status", "https://staging.summitridgeacademy.example/",
    { interval: 60, severity: "informational", lastMin: 14, lastSuccessMin: 2880,
      last: { status: "failed", http: 503, ms: 95, error: "HTTP 503 Service Unavailable" } });
  monitor(11, 6, "Homepage", "http_status", "https://coastalroofingpros.example/",
    { interval: 5, severity: "critical", lastMin: 3, lastSuccessMin: 3, last: ok(280) });
  monitor(12, 6, "Free Estimate Page", "expected_content", "https://coastalroofingpros.example/free-estimate",
    { expectedText: "Get Your Free Estimate", interval: 15, severity: "warning", lastMin: 8, lastSuccessMin: 68,
      last: { status: "failed", http: 200, ms: 801, error: 'Expected text "Get Your Free Estimate" not found' } });
  monitor(13, 7, "Homepage", "http_status", "https://mapleoaklaw.example/",
    { interval: 60, severity: "critical", active: false, lastMin: 17280, lastSuccessMin: 17280, last: ok(280) });

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

  return { clients, websites, monitors, summaries, incidents };
}
