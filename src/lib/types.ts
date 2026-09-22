// Row types mirror supabase/migrations. Keep them in sync when the schema changes.

export type Environment = "production" | "staging" | "development";
export type MonitorType = "http_status" | "response_time" | "expected_content";
export type CheckStatus = "passed" | "failed" | "warning";
export type Severity = "critical" | "warning" | "informational";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "snoozed"
  | "resolved"
  | "expected_maintenance"
  | "ignored";
export type AssignedTeam =
  | "development"
  | "account_management"
  | "seo"
  | "ads"
  | "client"
  | "unassigned";

export interface Client {
  id: string;
  name: string;
  primary_website: string | null;
  active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Website {
  id: string;
  client_id: string;
  name: string;
  url: string;
  environment: Environment;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Monitor {
  id: string;
  website_id: string;
  name: string;
  monitor_type: MonitorType;
  target_url: string;
  expected_status_code: number | null;
  expected_text: string | null;
  max_response_time_ms: number | null;
  interval_minutes: number;
  severity_on_failure: Severity;
  active: boolean;
  last_checked_at: string | null;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckResult {
  id: string;
  monitor_id: string;
  status: CheckStatus;
  checked_at: string;
  http_status: number | null;
  response_time_ms: number | null;
  passed: boolean;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

/** Row of the monitor_check_summary view: latest check + last known good. */
export interface MonitorCheckSummary {
  monitor_id: string;
  last_status: CheckStatus | null;
  last_result_at: string | null;
  last_http_status: number | null;
  last_response_time_ms: number | null;
  last_error_message: string | null;
  last_success_at: string | null;
}

export interface Incident {
  id: string;
  client_id: string;
  website_id: string | null;
  monitor_id: string | null;
  title: string;
  description: string;
  severity: Severity;
  status: IncidentStatus;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  assigned_team: AssignedTeam;
  internal_notes: string;
  created_at: string;
  updated_at: string;
}

/** Everything the UI needs, loaded in one pass. */
export interface Snapshot {
  clients: Client[];
  websites: Website[];
  monitors: Monitor[];
  summaries: MonitorCheckSummary[];
  incidents: Incident[];
}
