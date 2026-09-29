import "server-only";
import { isInFuture } from "@/lib/format";
import { decideIncident, type IncidentDecision } from "@/lib/monitoring/incident-engine";
import { SYSTEM_ACTOR, logIncidentEvent } from "@/lib/monitoring/incident-events";
import { withoutNul } from "@/lib/monitoring/storable";
import { alertFor } from "@/lib/notify/alerts";
import { notifyIncidentChange } from "@/lib/notify/send";
import { performCheck, type HttpCheckResult } from "@/lib/monitoring/run-check";
import type { AppSettings } from "@/lib/settings";
import { getSettings } from "@/lib/settings-store";
import { getSupabase } from "@/lib/supabase/server";
import type { CheckResult, Incident, Monitor } from "@/lib/types";

// Enough history to count a long failure streak for the incident description.
const ENGINE_HISTORY = 20;
const UNIQUE_VIOLATION = "23505";
// How soon a slower monitor re-checks to confirm a new failure or recovery.
const RECHECK_MINUTES = 5;

export interface RecordedCheck {
  result: CheckResult;
  incident: IncidentDecision["kind"];
}

/** A page speed monitor's scores from the 7 days before this check (for spotting a sharp drop). */
async function recentScores(monitorId: string, before: Date): Promise<number[]> {
  const { data, error } = await getSupabase()
    .from("check_results")
    .select("score:metadata->score")
    .eq("monitor_id", monitorId)
    .gte("checked_at", new Date(before.getTime() - 7 * 86_400_000).toISOString())
    .lt("checked_at", before.toISOString())
    .order("checked_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return (data as { score: unknown }[]).map((r) => r.score).filter((s): s is number => typeof s === "number");
}

/** Runs a monitor's check, stores the result, updates check times, and applies incident rules. */
export async function runAndRecordCheck(monitor: Monitor): Promise<RecordedCheck> {
  const checkedAt = new Date();
  const settings = await getSettings();
  const db = getSupabase();
  const previousScores = monitor.monitor_type === "page_speed" ? await recentScores(monitor.id, checkedAt) : undefined;
  let checked: HttpCheckResult;
  try {
    checked = await performCheck(monitor, settings, { previousScores });
  } catch (err) {
    // A bug or surprise in the check itself: record it (as a warning, not an outage)
    // so it's visible and the monitor moves on, instead of retrying silently forever.
    checked = {
      outcome: {
        status: "warning",
        passed: false,
        http_status: null,
        response_time_ms: Date.now() - checkedAt.getTime(),
        error_message: `Website Watch couldn't finish this check: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      },
      metadata: {},
    };
  }
  const { outcome, metadata } = withoutNul(checked);

  const { data, error } = await db
    .from("check_results")
    .insert({
      monitor_id: monitor.id,
      status: outcome.status,
      checked_at: checkedAt.toISOString(),
      http_status: outcome.http_status,
      response_time_ms: outcome.response_time_ms,
      passed: outcome.passed,
      error_message: outcome.error_message,
      metadata,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to save check result: ${error.message}`);

  const nextCheckAt = new Date(checkedAt.getTime() + monitor.interval_minutes * 60_000);
  const update = await db
    .from("monitors")
    .update({ last_checked_at: checkedAt.toISOString(), next_check_at: nextCheckAt.toISOString() })
    .eq("id", monitor.id);
  if (update.error) throw new Error(`Failed to update monitor: ${update.error.message}`);

  const { kind, hadIncident } = await applyIncidentRules(monitor, settings);

  // Hourly/daily/weekly monitors confirm a change quickly: a first failure is
  // re-checked within minutes (instead of a day later) before an incident opens,
  // and so is a first pass while an incident is open.
  const settling = (!outcome.passed && !hadIncident && kind === "none") || (outcome.passed && hadIncident && kind !== "resolve");
  if (settling && monitor.interval_minutes > RECHECK_MINUTES) {
    await db
      .from("monitors")
      .update({ next_check_at: new Date(checkedAt.getTime() + RECHECK_MINUTES * 60_000).toISOString() })
      .eq("id", monitor.id);
  }
  return { result: data as CheckResult, incident: kind };
}

async function applyIncidentRules(
  monitor: Monitor,
  settings: AppSettings,
): Promise<{ kind: IncidentDecision["kind"]; hadIncident: boolean }> {
  const db = getSupabase();
  const [history, current] = await Promise.all([
    db
      .from("check_results")
      .select("status, passed, checked_at, http_status, error_message")
      .eq("monitor_id", monitor.id)
      .order("checked_at", { ascending: false })
      .limit(ENGINE_HISTORY),
    db
      .from("incidents")
      .select("*")
      .eq("monitor_id", monitor.id)
      .is("resolved_at", null)
      .neq("status", "resolved")
      .maybeSingle(),
  ]);
  if (history.error) throw new Error(`Failed to load check history: ${history.error.message}`);
  if (current.error) throw new Error(`Failed to load current incident: ${current.error.message}`);

  const existing = (current.data as Incident | null) ?? undefined;
  const decision = decideIncident(monitor, history.data as CheckResult[], existing, settings);

  switch (decision.kind) {
    case "none":
      break;

    case "open": {
      const website = await db
        .from("websites")
        .select("client_id, maintenance_until")
        .eq("id", monitor.website_id)
        .single();
      if (website.error) throw new Error(`Failed to load website: ${website.error.message}`);
      // During a maintenance window, record the problem without alerting anyone.
      const inMaintenance = isInFuture(website.data.maintenance_until);
      const insert = await db
        .from("incidents")
        .insert({
          ...decision.incident,
          client_id: website.data.client_id,
          website_id: monitor.website_id,
          monitor_id: monitor.id,
          status: inMaintenance ? "expected_maintenance" : "open",
          assigned_team: "unassigned",
        })
        .select("id")
        .single();
      // Another check opened it at the same moment; that's fine.
      if (insert.error && insert.error.code === UNIQUE_VIOLATION) break;
      if (insert.error) throw new Error(`Failed to open incident: ${insert.error.message}`);
      await logIncidentEvent(
        insert.data.id,
        SYSTEM_ACTOR,
        "opened",
        `Opened after ${settings.failuresToOpen} consecutive failed checks (${decision.incident.severity})` +
          (inMaintenance ? " during a maintenance window, so marked Expected Maintenance" : ""),
      );
      await notifyIncidentChange("opened", insert.data.id);
      break;
    }

    case "update": {
      const incident = existing!;
      const res = await db.from("incidents").update(decision.changes).eq("id", incident.id);
      if (res.error) throw new Error(`Failed to update incident: ${res.error.message}`);
      if (decision.changes.severity !== incident.severity) {
        await logIncidentEvent(
          incident.id,
          SYSTEM_ACTOR,
          "severity_changed",
          `Severity raised from ${incident.severity} to ${decision.changes.severity}`,
        );
        await notifyIncidentChange("escalated", incident.id);
        break;
      }
      if (incident.status === "expected_maintenance") {
        // Still failing after the maintenance window ended: it's a real problem now.
        const website = await db.from("websites").select("maintenance_until").eq("id", monitor.website_id).single();
        if (website.error) throw new Error(`Failed to load website: ${website.error.message}`);
        if (!isInFuture(website.data.maintenance_until)) {
          const reopened = await db
            .from("incidents")
            .update({ status: "open" })
            .eq("id", incident.id)
            .eq("status", "expected_maintenance")
            .select("id");
          if (reopened.error) throw new Error(`Failed to reopen incident: ${reopened.error.message}`);
          if (reopened.data.length > 0) {
            await logIncidentEvent(incident.id, SYSTEM_ACTOR, "status_changed", "Maintenance window ended and it's still failing; reopened");
            await notifyIncidentChange("opened", incident.id);
          }
        }
        break;
      }
      // A Critical incident whose alert never went out (Slack was down or not set
      // up yet): try again. notifyIncidentChange claims it, so it's sent once.
      if (!incident.alerted_at && alertFor("opened", incident)) await notifyIncidentChange("opened", incident.id);
      break;
    }

    case "resolve": {
      // Keep "ignored" as the status so history shows nobody acted on it; just close it.
      const status = existing!.status === "ignored" ? "ignored" : "resolved";
      // Only if still unresolved: someone may have resolved it by hand meanwhile,
      // and it must not be closed (and announced) twice.
      const res = await db
        .from("incidents")
        .update({ status, resolved_at: decision.resolvedAt })
        .eq("id", existing!.id)
        .is("resolved_at", null)
        .select("id");
      if (res.error) throw new Error(`Failed to resolve incident: ${res.error.message}`);
      if (res.data.length === 0) break;
      await logIncidentEvent(
        existing!.id,
        SYSTEM_ACTOR,
        "resolved",
        status === "ignored"
          ? `Closed automatically after ${settings.passesToResolve} successful checks (was ignored)`
          : `Resolved automatically after ${settings.passesToResolve} successful checks`,
      );
      await notifyIncidentChange("resolved", existing!.id);
      break;
    }
  }
  return { kind: decision.kind, hadIncident: existing !== undefined };
}
