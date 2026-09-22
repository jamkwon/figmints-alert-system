import "server-only";
import { performHttpCheck } from "@/lib/monitoring/run-check";
import { getSupabase } from "@/lib/supabase/server";
import type { CheckResult, Monitor } from "@/lib/types";

/** Runs a monitor's check, stores the result, and updates last/next check times. */
export async function runAndRecordCheck(monitor: Monitor): Promise<CheckResult> {
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

  return data as CheckResult;
}
