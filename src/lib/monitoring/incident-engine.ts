// Pure incident rules: given a monitor's recent checks and its current unresolved
// incident, decide what should change. No I/O, so it's easy to test.
import type { CheckResult, Incident, Monitor, MonitorType, Severity } from "../types.ts";

export const FAILURES_TO_OPEN = 2;
export const SUCCESSES_TO_RESOLVE = 2;

type Check = Pick<CheckResult, "status" | "passed" | "checked_at" | "http_status" | "error_message">;

export type NewIncident = Pick<
  Incident,
  "title" | "description" | "severity" | "first_detected_at" | "last_detected_at"
>;

export type IncidentDecision =
  | { kind: "none" }
  | { kind: "open"; incident: NewIncident }
  | { kind: "update"; changes: Pick<Incident, "last_detected_at" | "description" | "severity"> }
  | { kind: "resolve"; resolvedAt: string };

const SEVERITY_RANK: Record<Severity, number> = { informational: 0, warning: 1, critical: 2 };

function worseSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** A failed check uses the monitor's severity; a slow one is at most a warning. */
export function severityForCheck(check: Check, monitorSeverity: Severity): Severity {
  if (check.status === "warning") return monitorSeverity === "informational" ? "informational" : "warning";
  return monitorSeverity;
}

export function titleForCheck(check: Check, monitorName: string, monitorType?: MonitorType): string {
  if (monitorType === "ssl_expiry") {
    return check.status === "warning"
      ? `SSL certificate for ${monitorName} expires soon`
      : `SSL certificate problem on ${monitorName}`;
  }
  if (monitorType === "broken_links" && check.status === "warning") return `Broken links found on ${monitorName}`;
  if (monitorType === "tracking_tags" && check.error_message?.startsWith("Missing tracking")) {
    return `Tracking tags missing on ${monitorName}`;
  }
  if (check.status === "warning") return `${monitorName} response time above threshold`;
  if (check.error_message?.startsWith("Expected text")) return `Expected content missing on ${monitorName}`;
  if (check.http_status !== null && check.http_status >= 400) return `${monitorName} returning HTTP ${check.http_status}`;
  if (check.http_status === null) return `${monitorName} is unreachable`;
  return `${monitorName} check failing`;
}

function describe(latest: Check, streak: number): string {
  const reason = latest.error_message ?? "Check did not pass";
  return `${reason}. ${streak} consecutive failed check${streak === 1 ? "" : "s"}.`;
}

function leadingRun(history: Check[], passed: boolean): number {
  let count = 0;
  while (count < history.length && history[count].passed === passed) count++;
  return count;
}

/**
 * @param history the monitor's most recent checks, newest first
 * @param current the monitor's unresolved incident, if any (any status except resolved)
 */
export function decideIncident(
  monitor: Pick<Monitor, "name" | "severity_on_failure"> & Partial<Pick<Monitor, "monitor_type">>,
  history: Check[],
  current: Pick<Incident, "severity"> | undefined,
): IncidentDecision {
  const latest = history[0];
  if (!latest) return { kind: "none" };

  const failStreak = leadingRun(history, false);
  const passStreak = leadingRun(history, true);

  if (current) {
    if (passStreak >= SUCCESSES_TO_RESOLVE) return { kind: "resolve", resolvedAt: latest.checked_at };
    if (failStreak === 0) return { kind: "none" }; // one pass: wait for a second before resolving
    return {
      kind: "update",
      changes: {
        last_detected_at: latest.checked_at,
        description: describe(latest, failStreak),
        // Escalate if things got worse (e.g. slow → down); never downgrade automatically.
        severity: worseSeverity(current.severity, severityForCheck(latest, monitor.severity_on_failure)),
      },
    };
  }

  if (failStreak < FAILURES_TO_OPEN) return { kind: "none" };
  const streak = history.slice(0, failStreak);
  return {
    kind: "open",
    incident: {
      title: titleForCheck(latest, monitor.name, monitor.monitor_type),
      description: describe(latest, failStreak),
      severity: streak
        .map((c) => severityForCheck(c, monitor.severity_on_failure))
        .reduce(worseSeverity),
      first_detected_at: streak[streak.length - 1].checked_at,
      last_detected_at: latest.checked_at,
    },
  };
}
