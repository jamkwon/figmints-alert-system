"use server";

import { refresh } from "next/cache";
import { isUnresolvedIncident } from "@/lib/health";
import { INCIDENT_STATUS_LABELS, TEAM_LABELS } from "@/lib/labels";
import type { IncidentDecision } from "@/lib/monitoring/incident-engine";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import type { AssignedTeam, Incident, IncidentStatus, Monitor } from "@/lib/types";

export interface RunCheckResult {
  ok: boolean;
  message: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stops repeated clicks from hammering a client's site.
const MIN_SECONDS_BETWEEN_RUNS = 10;

// Takes only a monitor ID: the URL always comes from the database, so this can't be
// used to fetch arbitrary addresses. There is no login yet; see README (Security).
export async function runCheckAction(monitorId: string): Promise<RunCheckResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Connect Supabase to run checks." };
  }
  if (typeof monitorId !== "string" || !UUID.test(monitorId)) {
    return { ok: false, message: "Unknown monitor." };
  }

  const db = getSupabase();
  const { data, error } = await db
    .from("monitors")
    .select("*, websites!inner(active, clients!inner(active))")
    .eq("id", monitorId)
    .maybeSingle();
  if (error) return { ok: false, message: `Could not load monitor: ${error.message}` };
  if (!data) return { ok: false, message: "Unknown monitor." };

  const { websites, ...monitor } = data as Monitor & {
    websites: { active: boolean; clients: { active: boolean } };
  };
  if (!monitor.active || !websites.active || !websites.clients.active) {
    return { ok: false, message: "This monitor is paused." };
  }
  if (
    monitor.last_checked_at &&
    Date.now() - new Date(monitor.last_checked_at).getTime() < MIN_SECONDS_BETWEEN_RUNS * 1000
  ) {
    return { ok: false, message: "Checked a moment ago. Try again in a few seconds." };
  }

  try {
    const { result, incident } = await runAndRecordCheck(monitor);
    refresh();
    const details = [
      result.http_status !== null ? `HTTP ${result.http_status}` : null,
      result.response_time_ms !== null ? `${result.response_time_ms} ms` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const incidentNote = INCIDENT_NOTES[incident];
    const message = result.passed
      ? `Passed${details ? ` · ${details}` : ""}`
      : `${result.status === "warning" ? "Warning" : "Failed"}: ${result.error_message}`;
    return { ok: result.passed, message: incidentNote ? `${message} · ${incidentNote}` : message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Check failed to run." };
  }
}

const INCIDENT_NOTES: Record<IncidentDecision["kind"], string | null> = {
  none: null,
  open: "Incident opened",
  update: null,
  resolve: "Incident resolved",
};

// Incidents -----------------------------------------------------------------------

export type IncidentActionResult = RunCheckResult;

const SETTABLE_STATUSES: readonly IncidentStatus[] = [
  "open",
  "investigating",
  "snoozed",
  "expected_maintenance",
  "ignored",
  "resolved",
];
const TEAMS = Object.keys(TEAM_LABELS) as AssignedTeam[];
const MAX_NOTES_LENGTH = 5000;

async function loadIncidentState(incidentId: string): Promise<IncidentActionResult | { resolved: boolean }> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Connect Supabase to update incidents." };
  if (typeof incidentId !== "string" || !UUID.test(incidentId)) return { ok: false, message: "Unknown incident." };
  const { data, error } = await getSupabase()
    .from("incidents")
    .select("status, resolved_at")
    .eq("id", incidentId)
    .maybeSingle();
  if (error) return { ok: false, message: `Could not load incident: ${error.message}` };
  if (!data) return { ok: false, message: "Unknown incident." };
  return { resolved: !isUnresolvedIncident(data as Pick<Incident, "status" | "resolved_at">) };
}

/** Status actions: Mark Investigating, Snooze, Expected Maintenance, Ignore, Resolve, Reopen. */
export async function setIncidentStatusAction(incidentId: string, status: IncidentStatus): Promise<IncidentActionResult> {
  if (!SETTABLE_STATUSES.includes(status)) return { ok: false, message: "Unknown status." };
  const loaded = await loadIncidentState(incidentId);
  if ("ok" in loaded) return loaded;
  // Resolved incidents are history. If the problem returns, the engine opens a new one.
  if (loaded.resolved) return { ok: false, message: "This incident is already closed." };

  const { error } = await getSupabase()
    .from("incidents")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", incidentId);
  if (error) return { ok: false, message: `Could not update incident: ${error.message}` };
  refresh();
  return { ok: true, message: `Marked ${INCIDENT_STATUS_LABELS[status]}.` };
}

/** Saves the assigned team and internal notes. Allowed on closed incidents too. */
export async function updateIncidentDetailsAction(
  incidentId: string,
  team: AssignedTeam,
  notes: string,
): Promise<IncidentActionResult> {
  if (!TEAMS.includes(team)) return { ok: false, message: "Unknown team." };
  if (typeof notes !== "string") return { ok: false, message: "Invalid notes." };
  const cleanNotes = notes.replace(/\r\n/g, "\n").trim();
  if (cleanNotes.length > MAX_NOTES_LENGTH) {
    return { ok: false, message: `Notes are limited to ${MAX_NOTES_LENGTH} characters.` };
  }
  const loaded = await loadIncidentState(incidentId);
  if ("ok" in loaded) return loaded;

  const { error } = await getSupabase()
    .from("incidents")
    .update({ assigned_team: team, internal_notes: cleanNotes })
    .eq("id", incidentId);
  if (error) return { ok: false, message: `Could not save: ${error.message}` };
  refresh();
  return { ok: true, message: "Saved." };
}
