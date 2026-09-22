"use server";

import { refresh } from "next/cache";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Monitor } from "@/lib/types";

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
    const result = await runAndRecordCheck(monitor);
    refresh();
    const details = [
      result.http_status !== null ? `HTTP ${result.http_status}` : null,
      result.response_time_ms !== null ? `${result.response_time_ms} ms` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (result.passed) return { ok: true, message: `Passed${details ? ` · ${details}` : ""}` };
    return { ok: false, message: `${result.status === "warning" ? "Warning" : "Failed"}: ${result.error_message}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Check failed to run." };
  }
}
