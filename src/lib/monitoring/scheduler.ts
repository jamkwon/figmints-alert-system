import "server-only";
import { SYSTEM_ACTOR, logIncidentEvent } from "@/lib/monitoring/incident-events";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { notifyIncidentChange } from "@/lib/notify/send";
import { maybeSendWeeklySummary } from "@/lib/notify/weekly-send";
import { getSupabase } from "@/lib/supabase/server";
import type { Monitor } from "@/lib/types";

// Sized so one run finishes inside a 60 s function limit: 20 monitors, 5 at a
// time. Most checks are capped at 15 s; a WordPress Health check can take up to
// ~35 s (the page, then the site plugin's report, which gets 20 s).
export const MAX_MONITORS_PER_RUN = 20;
const CONCURRENCY = 5;
// Stop starting new checks after this (20 s + a 35 s check still ends before
// 60 s). Unstarted monitors are released for the next run.
const TIME_BUDGET_MS = 20_000;
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
  /** "sent", "not_due", or what went wrong. */
  weeklySummary: string | null;
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
    weeklySummary: null,
    errors: [],
  };

  summary.snoozesReopened = await reopenExpiredSnoozes();
  // Once an hour: the run at minute 0 (the scheduler fires every minute or every 5).
  if (new Date(started).getUTCMinutes() === 0) summary.oldChecksDeleted = await deleteOldChecks();
  try {
    summary.weeklySummary = await maybeSendWeeklySummary(new Date(started));
  } catch (err) {
    summary.weeklySummary = `failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const { data, error } = await getSupabase().rpc("claim_due_monitors", { max_count: MAX_MONITORS_PER_RUN });
  if (error) throw new Error(`Failed to claim due monitors: ${error.message}`);
  const queue = [...((data as Monitor[] | null) ?? [])];
  summary.claimed = queue.length;

  const deferredIds: string[] = [];

  async function worker() {
    while (queue.length > 0) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        summary.deferred += queue.length;
        deferredIds.push(...queue.map((m) => m.id));
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
  if (deferredIds.length > 0) await releaseClaims(deferredIds);
  summary.durationMs = Date.now() - started;
  return summary;
}

/**
 * Claiming pushes next_check_at 5 minutes out; monitors this run didn't get to
 * are made due again so the next run (a minute later) checks them.
 */
async function releaseClaims(ids: string[]): Promise<void> {
  const { error } = await getSupabase().from("monitors").update({ next_check_at: new Date().toISOString() }).in("id", ids);
  if (error) console.error("[scheduler] could not release deferred monitors:", error.message);
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
  for (const { id } of data ?? []) {
    await logIncidentEvent(id, SYSTEM_ACTOR, "snooze_ended", "Snooze ended; reopened");
    await notifyIncidentChange("snooze_ended", id);
  }
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
