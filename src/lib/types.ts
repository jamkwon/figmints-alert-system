// Row types mirror supabase/migrations. Keep them in sync when the schema changes.

export type Environment = "production" | "staging" | "development";
export type MonitorType = "http_status" | "response_time" | "expected_content" | "ssl_expiry";
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
  /** While in the future, new incidents open as expected maintenance. */
  maintenance_until: string | null;
  maintenance_note: string;
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
  /** Latest check's metadata (for SSL monitors: valid_to, days_left, issuer). */
  last_metadata: Record<string, unknown> | null;
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
  /** Snoozed incidents reopen when this passes. */
  snoozed_until: string | null;
  /** When the Slack alert for this incident went out (at most once). */
  alerted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type IncidentEventKind =
  | "opened"
  | "status_changed"
  | "severity_changed"
  | "assigned"
  | "notes_updated"
  | "resolved"
  | "snooze_ended"
  | "alert_sent"
  | "alert_failed";

export interface IncidentEvent {
  id: string;
  incident_id: string;
  created_at: string;
  /** Staff email, or "system" for the incident engine. */
  actor: string;
  kind: IncidentEventKind;
  message: string;
}

/** Row of the monitor_uptime view. */
export interface MonitorUptime {
  monitor_id: string;
  checks_24h: number;
  passed_24h: number;
  checks_7d: number;
  passed_7d: number;
  checks_30d: number;
  passed_30d: number;
}

/** Everything the UI needs, loaded in one pass. */
export interface Snapshot {
  clients: Client[];
  websites: Website[];
  monitors: Monitor[];
  summaries: MonitorCheckSummary[];
  incidents: Incident[];
  uptime: MonitorUptime[];
}
