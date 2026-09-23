import "server-only";
import { decideIncident, type IncidentDecision } from "@/lib/monitoring/incident-engine";
import { performHttpCheck } from "@/lib/monitoring/run-check";
import { getSupabase } from "@/lib/supabase/server";
import type { CheckResult, Incident, Monitor } from "@/lib/types";

// Enough history to count a long failure streak for the incident description.
const ENGINE_HISTORY = 20;
const UNIQUE_VIOLATION = "23505";

export interface RecordedCheck {
  result: CheckResult;
  incident: IncidentDecision["kind"];
}

/** Runs a monitor's check, stores the result, updates check times, and applies incident rules. */
export async function runAndRecordCheck(monitor: Monitor): Promise<RecordedCheck> {
  const checkedAt = new Date();
  const { outcome, metadata } = await performHttpCheck(monitor);
  const db = getSupabase();

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

  const incident = await applyIncidentRules(monitor);
  return { result: data as CheckResult, incident };
}

async function applyIncidentRules(monitor: Monitor): Promise<IncidentDecision["kind"]> {
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
  const decision = decideIncident(monitor, history.data as CheckResult[], existing);

  switch (decision.kind) {
    case "none":
      break;

    case "open": {
      const website = await db.from("websites").select("client_id").eq("id", monitor.website_id).single();
      if (website.error) throw new Error(`Failed to load website: ${website.error.message}`);
      const insert = await db.from("incidents").insert({
        ...decision.incident,
        client_id: website.data.client_id,
        website_id: monitor.website_id,
        monitor_id: monitor.id,
        status: "open",
        assigned_team: "unassigned",
      });
      // Another check opened it at the same moment; that's fine.
      if (insert.error && insert.error.code !== UNIQUE_VIOLATION) {
        throw new Error(`Failed to open incident: ${insert.error.message}`);
      }
      break;
    }

    case "update": {
      const res = await db.from("incidents").update(decision.changes).eq("id", existing!.id);
      if (res.error) throw new Error(`Failed to update incident: ${res.error.message}`);
      break;
    }

    case "resolve": {
      // Keep "ignored" as the status so history shows nobody acted on it; just close it.
      const status = existing!.status === "ignored" ? "ignored" : "resolved";
      const res = await db
        .from("incidents")
        .update({ status, resolved_at: decision.resolvedAt })
        .eq("id", existing!.id);
      if (res.error) throw new Error(`Failed to resolve incident: ${res.error.message}`);
      break;
    }
  }
  return decision.kind;
}
