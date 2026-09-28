import "server-only";
import { loadSystemAppData } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { appUrl, postToSlack, slackWebhookUrl } from "@/lib/notify/send";
import { buildWeeklySummary, summaryWeek, type SummaryInput } from "@/lib/notify/weekly";
import { getSupabase } from "@/lib/supabase/server";

async function summaryInput(now: Date): Promise<SummaryInput> {
  const { monitors, incidents } = await loadSystemAppData();
  return {
    monitors: monitors
      .filter((m) => m.monitor.active && m.website.active && m.client.active)
      .map((m) => ({
        clientName: m.client.name,
        websiteUrl: m.website.url,
        environment: m.website.environment,
        monitorType: m.monitor.monitor_type,
        lastStatus: m.summary?.last_status ?? null,
        lastErrorMessage: m.summary?.last_error_message ?? null,
        metadata: m.summary?.last_metadata ?? null,
        checks7d: m.uptime?.checks_7d ?? 0,
        passed7d: m.uptime?.passed_7d ?? 0,
      })),
    incidents: incidents.map((i) => ({
      clientName: i.client.name,
      monitorType: i.monitor?.monitor_type ?? null,
      title: i.incident.title,
      severity: i.incident.severity,
      resolved: i.incident.resolved_at !== null,
      firstDetectedAt: i.incident.first_detected_at,
    })),
    now,
    appUrl: appUrl(),
  };
}

/** Builds and posts the summary now. Returns an error message, or null when posted. */
export async function sendWeeklySummary(now = new Date()): Promise<string | null> {
  if (!slackWebhookUrl()) return "SLACK_WEBHOOK_URL is not set";
  const { text, blocks } = buildWeeklySummary(await summaryInput(now));
  return postToSlack({ text, blocks });
}

// The week this server instance already knows is done, to skip the database check.
let doneWeek: string | null = null;

/**
 * Called by every scheduler run: sends this week's summary once it's due
 * (Monday 9:00 in APP_TIMEZONE, or later that week if the scheduler was down).
 * Claims the week in the database first, so overlapping runs can't both send.
 */
export async function maybeSendWeeklySummary(now = new Date()): Promise<"sent" | "not_due" | string> {
  if (!slackWebhookUrl()) return "not_due";
  const { weekStart, due } = summaryWeek(now, APP_TIMEZONE);
  if (!due || doneWeek === weekStart) return "not_due";
  const db = getSupabase();
  const claim = await db
    .from("weekly_summaries")
    .upsert({ week_start: weekStart }, { onConflict: "week_start", ignoreDuplicates: true })
    .select("week_start");
  if (claim.error) return `could not claim the week: ${claim.error.message}`;
  if (!claim.data?.length) {
    doneWeek = weekStart; // already sent this week
    return "not_due";
  }
  let failure: string | null;
  try {
    failure = await sendWeeklySummary(now);
  } catch (err) {
    failure = err instanceof Error ? err.message : "could not build the summary";
  }
  if (failure) {
    // Let the next run try again.
    await db.from("weekly_summaries").delete().eq("week_start", weekStart);
    return `failed: ${failure}`;
  }
  doneWeek = weekStart;
  return "sent";
}
