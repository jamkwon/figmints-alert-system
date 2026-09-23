import "server-only";
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
    errors: [],
  };

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
