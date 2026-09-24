import type { Health } from "@/lib/health";
import { INCIDENT_STATUS_LABELS, SEVERITY_LABELS, TEAM_LABELS } from "@/lib/labels";
import type { AssignedTeam, CheckStatus, IncidentStatus, MonitorType, Severity } from "@/lib/types";

// One place for status colors so every screen uses the same indicators:
// red = critical, amber = warning, teal = healthy, gray = informational/inactive.
const HEALTH_STYLES: Record<Health, { label: string; dot: string; badge: string }> = {
  critical: {
    label: "Critical",
    dot: "bg-fig-coral",
    badge: "bg-fig-coral-wash text-red-800 ring-red-200",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800 ring-amber-300",
  },
  informational: {
    label: "Informational",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
  },
  unknown: {
    label: "No data",
    dot: "bg-white ring-1 ring-inset ring-slate-400",
    badge: "bg-white text-slate-600 ring-slate-300",
  },
  healthy: {
    label: "Healthy",
    dot: "bg-fig-teal-light",
    badge: "bg-fig-teal-wash text-fig-teal ring-teal-200",
  },
  inactive: {
    label: "Inactive",
    dot: "bg-slate-300",
    badge: "bg-slate-50 text-slate-500 ring-slate-200",
  },
};

const badgeBase =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export function HealthDot({ health, className = "" }: { health: Health; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 shrink-0 rounded-full ${HEALTH_STYLES[health].dot} ${className}`}
    />
  );
}

export function HealthBadge({ health, label }: { health: Health; label?: string }) {
  const style = HEALTH_STYLES[health];
  return (
    <span className={`${badgeBase} ${style.badge}`}>
      <HealthDot health={health} className="size-2" />
      {label ?? style.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <HealthBadge health={severity} label={SEVERITY_LABELS[severity]} />;
}

const CHECK_STATUS_DISPLAY: Record<CheckStatus, { health: Health; label: string }> = {
  passed: { health: "healthy", label: "Passed" },
  warning: { health: "warning", label: "Slow" },
  failed: { health: "critical", label: "Failed" },
};

/** Result of a single check run. A warning means "slow" for pages, "expiring soon" for certificates. */
export function CheckStatusBadge({ status, monitorType }: { status: CheckStatus; monitorType?: MonitorType }) {
  const { health, label } = CHECK_STATUS_DISPLAY[status];
  const warningLabel = monitorType === "ssl_expiry" ? "Expiring soon" : monitorType === "broken_links" ? "Broken links" : label;
  return <HealthBadge health={health} label={status === "warning" ? warningLabel : label} />;
}

const INCIDENT_STATUS_STYLES: Record<IncidentStatus, string> = {
  open: "bg-fig-plum text-white ring-fig-plum",
  investigating: "bg-fig-pink-light/50 text-fig-plum ring-fig-pink-light",
  snoozed: "bg-slate-100 text-slate-600 ring-slate-200",
  expected_maintenance: "bg-slate-100 text-slate-600 ring-slate-200",
  resolved: "bg-fig-teal-wash text-fig-teal ring-teal-200",
  ignored: "bg-white text-slate-500 ring-slate-200",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span className={`${badgeBase} ${INCIDENT_STATUS_STYLES[status]}`}>
      {INCIDENT_STATUS_LABELS[status]}
    </span>
  );
}

export function TeamLabel({ team }: { team: AssignedTeam }) {
  return (
    <span className={team === "unassigned" ? "text-slate-400 italic" : "text-fig-ink-light"}>
      {TEAM_LABELS[team]}
    </span>
  );
}
