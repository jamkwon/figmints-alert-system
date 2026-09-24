import "server-only";
import { SYSTEM_ACTOR, logIncidentEvent } from "@/lib/monitoring/incident-events";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { getSupabase } from "@/lib/supabase/server";
import type { Monitor } from "@/lib/types";

// Sized so one run finishes well inside a 60 s function limit:
// 20 monitors, 5 at a time, each check capped at 15 s.
const MAX_MONITORS_PER_RUN = 20;
const CONCURRENCY = 5;
// Stop starting new checks after this; unstarted monitors are retried next run
// once their claim lease (5 min) expires.
const TIME_BUDGET_MS = 40_000;
// Check results older than this are deleted (once an hour).
export const RETENTION_DAYS = 90;

export interface SchedulerRunSummary {
  startedAt: string;
  durationMs: number;
  claimed: number;
  checked: number;
  passed: number;
  failed: number;
  incidentsOpened: number;
  incidentsResolved: number;
  /** Claimed but not started because the time budget ran out. */
  deferred: number;
  snoozesReopened: number;
  oldChecksDeleted: number | null;
  errors: { monitorId: string; message: string }[];
}

/** The single scheduled worker: claims monitors that are due and checks them. */
export async function runDueChecks(): Promise<SchedulerRunSummary> {
  const started = Date.now();
  const summary: SchedulerRunSummary = {
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    claimed: 0,
    checked: 0,
    passed: 0,
    failed: 0,
    incidentsOpened: 0,
    incidentsResolved: 0,
    deferred: 0,
    snoozesReopened: 0,
    oldChecksDeleted: null,
    errors: [],
  };

  summary.snoozesReopened = await reopenExpiredSnoozes();
  // First run of each hour only; the scheduler fires every 5 minutes.
  if (new Date(started).getUTCMinutes() < 5) summary.oldChecksDeleted = await deleteOldChecks();

  const { data, error } = await getSupabase().rpc("claim_due_monitors", { max_count: MAX_MONITORS_PER_RUN });
  if (error) throw new Error(`Failed to claim due monitors: ${error.message}`);
  const queue = [...((data as Monitor[] | null) ?? [])];
  summary.claimed = queue.length;

  async function worker() {
    while (queue.length > 0) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        summary.deferred += queue.length;
        queue.length = 0;
        return;
      }
      const monitor = queue.shift()!;
      try {
        const { result, incident } = await runAndRecordCheck(monitor);
        summary.checked++;
        if (result.passed) summary.passed++;
        else summary.failed++;
        if (incident === "open") summary.incidentsOpened++;
        if (incident === "resolve") summary.incidentsResolved++;
      } catch (err) {
        summary.errors.push({ monitorId: monitor.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  summary.durationMs = Date.now() - started;
  return summary;
}

/** Snoozes that have run out go back to Open (and back onto the dashboard). */
async function reopenExpiredSnoozes(): Promise<number> {
  const { data, error } = await getSupabase()
    .from("incidents")
    .update({ status: "open", snoozed_until: null })
    .eq("status", "snoozed")
    .is("resolved_at", null)
    .lte("snoozed_until", new Date().toISOString())
    .select("id");
  if (error) {
    console.error("[scheduler] could not reopen snoozed incidents:", error.message);
    return 0;
  }
  for (const { id } of data ?? []) await logIncidentEvent(id, SYSTEM_ACTOR, "snooze_ended", "Snooze ended; reopened");
  return data?.length ?? 0;
}

async function deleteOldChecks(): Promise<number | null> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3_600_000).toISOString();
  const { count, error } = await getSupabase()
    .from("check_results")
    .delete({ count: "exact" })
    .lt("checked_at", cutoff);
  if (error) {
    console.error("[scheduler] could not delete old checks:", error.message);
    return null;
  }
  return count ?? 0;
}
