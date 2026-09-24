import type {
  AssignedTeam,
  Environment,
  IncidentStatus,
  MonitorType,
  Severity,
} from "@/lib/types";

export const MONITOR_TYPE_LABELS: Record<MonitorType, string> = {
  http_status: "HTTP Status",
  response_time: "Response Time",
  expected_content: "Expected Content",
  ssl_expiry: "SSL Certificate",
  broken_links: "Broken Links",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  informational: "Informational",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  snoozed: "Snoozed",
  resolved: "Resolved",
  expected_maintenance: "Expected Maintenance",
  ignored: "Ignored",
};

export const TEAM_LABELS: Record<AssignedTeam, string> = {
  development: "Development",
  account_management: "Account Management",
  seo: "SEO",
  ads: "Ads",
  client: "Client",
  unassigned: "Unassigned",
};

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
};

export function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "Daily" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "Hourly" : `Every ${minutes / 60} hours`;
  return `Every ${minutes} min`;
}

/** Snooze durations offered on incidents. */
export const SNOOZE_HOURS = [1, 4, 24, 168] as const;

/** Maintenance window lengths offered on websites. */
export const MAINTENANCE_HOURS = [1, 4, 24, 72, 168] as const;

/** "1 hour", "4 hours", "24 hours", "3 days", "7 days". */
export function durationLabel(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? "24 hours" : `${hours / 24} days`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Allowed values for forms. Kept here (no server imports) so client components can use them.
export const INTERVALS = [5, 15, 30, 60, 360, 1440] as const;
export const MONITOR_TYPES: readonly MonitorType[] = [
  "http_status",
  "expected_content",
  "response_time",
  "ssl_expiry",
  "broken_links",
];

/** Availability checks count toward uptime; SSL and link scans don't (they aren't downtime). */
export function countsTowardUptime(type: MonitorType): boolean {
  return type === "http_status" || type === "expected_content" || type === "response_time";
}
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "informational"];
export const ENVIRONMENTS: readonly Environment[] = ["production", "staging", "development"];
