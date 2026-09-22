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
