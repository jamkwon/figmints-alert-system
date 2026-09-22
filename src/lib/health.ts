// Pure health rules. Only type imports here so `node --test` can run the tests
// without a bundler.
import type { Incident, IncidentStatus, Monitor, MonitorCheckSummary } from "@/lib/types";

export type Health = "critical" | "warning" | "informational" | "unknown" | "healthy" | "inactive";

/** Incidents someone should be looking at now. */
export const ATTENTION_STATUSES: readonly IncidentStatus[] = ["open", "investigating"];
/** Incidents that are not finished (includes quiet ones: snoozed, maintenance). */
export const ACTIVE_STATUSES: readonly IncidentStatus[] = [
  "open",
  "investigating",
  "snoozed",
  "expected_maintenance",
];

const RANK: Record<Health, number> = {
  critical: 5,
  warning: 4,
  informational: 3,
  unknown: 2,
  healthy: 1,
  inactive: 0,
};

export function needsAttention(incident: Incident): boolean {
  return ATTENTION_STATUSES.includes(incident.status);
}

export function isActiveIncident(incident: Incident): boolean {
  return ACTIVE_STATUSES.includes(incident.status);
}

export function compareHealth(a: Health, b: Health): number {
  return RANK[b] - RANK[a];
}

/** Most severe health in the list, ignoring inactive entries. Empty → unknown. */
export function worstHealth(list: Health[]): Health {
  const relevant = list.filter((h) => h !== "inactive");
  if (relevant.length === 0) return "unknown";
  return relevant.reduce((worst, h) => (RANK[h] > RANK[worst] ? h : worst));
}

/** Health contributed by a single incident. Resolved/ignored incidents contribute nothing. */
export function incidentHealth(incident: Incident): Health | null {
  if (!isActiveIncident(incident)) return null;
  // Snoozed and expected-maintenance incidents are known and parked.
  if (!needsAttention(incident)) return "informational";
  return incident.severity;
}

/**
 * Current health of one monitor.
 * An active incident wins; otherwise the latest check decides. A failed check
 * without an incident (below the 2-consecutive-failure threshold) shows as warning.
 */
export function monitorHealth(
  monitor: Monitor,
  summary: MonitorCheckSummary | undefined,
  monitorIncidents: Incident[],
  parentActive = true,
): Health {
  if (!monitor.active || !parentActive) return "inactive";

  const fromIncidents = monitorIncidents
    .map(incidentHealth)
    .filter((h): h is Health => h !== null);
  if (fromIncidents.length > 0) return worstHealth(fromIncidents);

  switch (summary?.last_status) {
    case "passed":
      return "healthy";
    case "failed":
    case "warning":
      return "warning";
    default:
      return "unknown";
  }
}

/**
 * Rolls monitor health and any active incidents (including ones not tied to a
 * monitor) up to a website or client.
 */
export function rollUpHealth(active: boolean, monitorHealths: Health[], incidents: Incident[]): Health {
  if (!active) return "inactive";
  const fromIncidents = incidents
    .map(incidentHealth)
    .filter((h): h is Health => h !== null);
  return worstHealth([...monitorHealths, ...fromIncidents]);
}
