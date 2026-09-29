import "server-only";
import { loadReportInput } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { buildMonthlyReportsMessage, monthlyPostDue, type ClientReportLine } from "@/lib/notify/monthly";
import { appUrl, postToSlack, slackWebhookUrl } from "@/lib/notify/send";
import { buildMonthlyReport, monthRange } from "@/lib/report";
import { getSettings } from "@/lib/settings-store";
import { getSupabase } from "@/lib/supabase/server";

// Building reports stops after this, so posting fits in a scheduler run; the
// message then lists the rest as "…and N more".
const BUILD_BUDGET_MS = 25_000;
const CONCURRENCY = 4;

/** Builds last month's (or `monthKey`'s) reports for active clients and posts one Slack message. */
export async function sendMonthlyReports(monthKey?: string, now = new Date()): Promise<string | null> {
  if (!slackWebhookUrl()) return "SLACK_WEBHOOK_URL is not set";
  const settings = await getSettings();
  const key = monthKey ?? monthlyPostDue(now, APP_TIMEZONE, settings.summaryHour).month;
  const month = monthRange(key, APP_TIMEZONE);
  if (!month) return `Not a month: ${key}`;

  const { data: clients, error } = await getSupabase().from("clients").select("id, name").eq("active", true).order("name");
  if (error) return `Could not load clients: ${error.message}`;
  const base = appUrl()?.replace(/\/$/, "") ?? null;
  const started = Date.now();
  const lines: ClientReportLine[] = [];
  const queue = [...(clients as { id: string; name: string }[])];
  let skipped = 0;
  async function worker() {
    while (queue.length > 0) {
      const client = queue.shift()!;
      if (Date.now() - started > BUILD_BUDGET_MS) {
        skipped++;
        continue;
      }
      const data = await loadReportInput(client.id, month!);
      // Clients without websites have nothing to report.
      if (!data || data.input.websites.length === 0) continue;
      lines.push({
        clientName: client.name,
        url: base ? `${base}/clients/${client.id}/report?month=${key}` : null,
        report: buildMonthlyReport({ ...data.input, now }),
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (skipped > 0) console.warn(`[monthly reports] ${skipped} client(s) left out: out of time`);
  return postToSlack(buildMonthlyReportsMessage(month.label, lines, appUrl()));
}

// The month this server instance already knows is posted, to skip the database check.
let doneMonth: string | null = null;

/**
 * Called by every scheduler run: on the 1st (at the weekly summary's hour), posts
 * the month that just ended, once. Claims the month in the database first.
 */
export async function maybeSendMonthlyReports(now = new Date()): Promise<"sent" | "not_due" | "off" | string> {
  if (!slackWebhookUrl()) return "not_due";
  const settings = await getSettings();
  if (!settings.monthlyReportsEnabled) return "off";
  const { month, due } = monthlyPostDue(now, APP_TIMEZONE, settings.summaryHour);
  if (!due || doneMonth === month) return "not_due";
  const db = getSupabase();
  const claim = await db
    .from("monthly_report_posts")
    .upsert({ month }, { onConflict: "month", ignoreDuplicates: true })
    .select("month");
  if (claim.error) return `could not claim the month: ${claim.error.message}`;
  if (!claim.data?.length) {
    doneMonth = month;
    return "not_due";
  }
  let failure: string | null;
  try {
    failure = await sendMonthlyReports(month, now);
  } catch (err) {
    failure = err instanceof Error ? err.message : "could not build the reports";
  }
  if (failure) {
    // Let the next run try again.
    await db.from("monthly_report_posts").delete().eq("month", month);
    return `failed: ${failure}`;
  }
  doneMonth = month;
  return "sent";
}
