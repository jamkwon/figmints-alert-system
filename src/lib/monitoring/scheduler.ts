import "server-only";
import { SYSTEM_ACTOR, logIncidentEvent } from "@/lib/monitoring/incident-events";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { notifyIncidentChange } from "@/lib/notify/send";
import { maybeSendWeeklySummary } from "@/lib/notify/weekly-send";
import { maybeSendMonthlyReports } from "@/lib/notify/monthly-send";
import { getSupabase } from "@/lib/supabase/server";
import type { Monitor } from "@/lib/types";

// A run must finish inside a 60 s function limit. It checks 10 monitors at a
// time and claims more, in batches, as it goes, until TIME_BUDGET_MS or
// MAX_MONITORS_PER_RUN. Most checks take a second or two and are capped at 15 s;
// WordPress Health and Contact Form checks can take up to ~35 s.
export const MAX_MONITORS_PER_RUN = 150;
const CONCURRENCY = 10;
// Claimed at a time: enough that slow types (sorted first) start early.
const CLAIM_BATCH = 20;
/**
 * Roughly how many checks one run gets through when most are quick page checks
 * (for capacity estimates; the real number depends on how fast the sites answer).
 */
export const CHECKS_PER_RUN_ESTIMATE = 80;
// Stop starting new checks after this (20 s + a 35 s check still ends before
// 60 s). Unstarted monitors are released for the next run.
const TIME_BUDGET_MS = 20_000;
// Slow check types only start early in a run, so they still end before 60 s:
// page speed (up to 45 s) in the first 5 s; link scans, WordPress Health and
// contact forms (up to ~40 s) in the first 10 s. They're queued first; the rest
// can start until TIME_BUDGET_MS. Later ones are released for the next run.
const START_WINDOW_MS: Partial<Record<Monitor["monitor_type"], number>> = {
  page_speed: 5_000,
  broken_links: 10_000,
  wordpress_health: 10_000,
  contact_form: 10_000,
};
// Weekly/monthly Slack posting runs after the checks, only if this much of the
// run is left, so posting can never crowd out monitoring.
const POSTING_START_BY_MS = 30_000;
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
  /** Monthly client reports in Slack on the 1st: "sent", "not_due", "off", or what went wrong. */
  monthlyReports: string | null;
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
    monthlyReports: null,
    errors: [],
  };

  summary.snoozesReopened = await reopenExpiredSnoozes();
  // Once an hour: the run at minute 0 (the scheduler fires every minute or every 5).
  if (new Date(started).getUTCMinutes() === 0) summary.oldChecksDeleted = await deleteOldChecks();

  // Slow types first (shortest start window first), so they start while there's time.
  const windowOf = (m: Monitor) => START_WINDOW_MS[m.monitor_type] ?? TIME_BUDGET_MS;
  const queue: Monitor[] = [];
  // No more to claim: nothing else due, the per-run cap, or out of time.
  let exhausted = false;
  let claiming: Promise<void> | null = null;

  async function claimBatch(): Promise<void> {
    const want = Math.min(CLAIM_BATCH, MAX_MONITORS_PER_RUN - summary.claimed);
    if (want <= 0 || Date.now() - started > TIME_BUDGET_MS) {
      exhausted = true;
      return;
    }
    const { data, error } = await getSupabase().rpc("claim_due_monitors", { max_count: want });
    if (error) throw new Error(`Failed to claim due monitors: ${error.message}`);
    const got = (data as Monitor[] | null) ?? [];
    summary.claimed += got.length;
    if (got.length < want) exhausted = true;
    queue.push(...got);
    queue.sort((a, b) => windowOf(a) - windowOf(b));
  }

  /** One claim at a time, shared by every worker that ran out of work. */
  async function refill(): Promise<void> {
    claiming ??= claimBatch()
      .catch((err) => {
        exhausted = true;
        summary.errors.push({ monitorId: "-", message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        claiming = null;
      });
    await claiming;
  }

  // The first claim's failure fails the run (the scheduler status shows it).
  await claimBatch();

  // Monitors this run won't check are handed back right away (not after the run),
  // so a run cut short at 60 s doesn't also hold them for the 5-minute lease.
  const releases: Promise<void>[] = [];
  const release = (ids: string[]) => {
    if (ids.length === 0) return;
    summary.deferred += ids.length;
    releases.push(releaseClaims(ids));
  };

  async function worker() {
    for (;;) {
      if (queue.length === 0) {
        if (exhausted) return;
        await refill();
        continue;
      }
      const elapsed = Date.now() - started;
      if (elapsed > TIME_BUDGET_MS) {
        release(queue.splice(0).map((m) => m.id));
        return;
      }
      if (elapsed > windowOf(queue[0])) {
        // Too late to start this one safely; the next run starts it first.
        release([queue.shift()!.id]);
        continue;
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

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await Promise.all(releases);

  // Slack posting last, and only with time to spare; if not, a later run posts it
  // (both catch up for 24 hours).
  if (Date.now() - started < POSTING_START_BY_MS) {
    try {
      summary.weeklySummary = await maybeSendWeeklySummary(new Date(started));
    } catch (err) {
      summary.weeklySummary = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (Date.now() - started < POSTING_START_BY_MS) {
    try {
      summary.monthlyReports = await maybeSendMonthlyReports(new Date(started));
    } catch (err) {
      summary.monthlyReports = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
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
  // In parallel: many snoozes ending together shouldn't eat the run's time.
  await Promise.all(
    (data ?? []).map(async ({ id }) => {
      await logIncidentEvent(id, SYSTEM_ACTOR, "snooze_ended", "Snooze ended; reopened");
      await notifyIncidentChange("snooze_ended", id);
    }),
  );
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
