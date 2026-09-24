import "server-only";
import { logIncidentEvent, SYSTEM_ACTOR } from "@/lib/monitoring/incident-events";
import { alertFor, buildSlackMessage, type IncidentChange } from "@/lib/notify/alerts";
import { firstSetEnv } from "@/lib/supabase/config";
import { getSupabase } from "@/lib/supabase/server";
import type { Incident } from "@/lib/types";

const SLACK_TIMEOUT_MS = 5000;

/** Slack Incoming Webhook URL. Only hooks.slack.com is accepted. */
export function slackWebhookUrl(): string | null {
  const url = firstSetEnv(["SLACK_WEBHOOK_URL"])?.value;
  return url && url.startsWith("https://hooks.slack.com/") ? url : null;
}

/** Base URL for links in alerts: APP_URL, or Vercel's production domain. */
export function appUrl(): string | null {
  const explicit = firstSetEnv(["APP_URL"])?.value;
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

async function postToSlack(message: { text: string; blocks: unknown[] }): Promise<string | null> {
  const url = slackWebhookUrl();
  if (!url) return "SLACK_WEBHOOK_URL is not set";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (!res.ok) return `Slack answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Request to Slack failed";
  }
}

type IncidentWithNames = Incident & {
  clients: { name: string } | null;
  monitors: { name: string; target_url: string } | null;
};

/**
 * Sends a Slack alert if the change deserves one (see alertFor). Never throws:
 * alerting must not break checks or actions. Outcomes go to incident history.
 */
export async function notifyIncidentChange(change: IncidentChange, incidentId: string, actor?: string): Promise<void> {
  try {
    if (!slackWebhookUrl()) return;
    const db = getSupabase();
    const { data, error } = await db
      .from("incidents")
      .select("*, clients(name), monitors(name, target_url)")
      .eq("id", incidentId)
      .maybeSingle();
    if (error || !data) return;
    const incident = data as IncidentWithNames;
    const kind = alertFor(change, incident);
    if (!kind) return;

    // Claim the alert first so two checks finishing together can't both send it.
    if (kind !== "resolved") {
      const claim = await db
        .from("incidents")
        .update({ alerted_at: new Date().toISOString() })
        .eq("id", incidentId)
        .is("alerted_at", null)
        .select("id");
      if (claim.error || !claim.data?.length) return;
    }

    const latestFailure = incident.monitor_id
      ? await db
          .from("check_results")
          .select("error_message")
          .eq("monitor_id", incident.monitor_id)
          .eq("passed", false)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : null;

    const failure = await postToSlack(
      buildSlackMessage({
        kind,
        incident,
        clientName: incident.clients?.name ?? "Unknown client",
        monitorName: incident.monitors?.name ?? null,
        targetUrl: incident.monitors?.target_url ?? null,
        error: latestFailure?.data?.error_message ?? null,
        appUrl: appUrl(),
        actor: actor && actor !== SYSTEM_ACTOR ? actor : null,
      }),
    );

    if (failure) {
      // Let the next change try again.
      if (kind !== "resolved") await db.from("incidents").update({ alerted_at: null }).eq("id", incidentId);
      await logIncidentEvent(incidentId, SYSTEM_ACTOR, "alert_failed", `Slack alert failed: ${failure}`);
      console.error(`[alerts] Slack alert for ${incidentId} failed: ${failure}`);
      return;
    }
    await logIncidentEvent(
      incidentId,
      SYSTEM_ACTOR,
      "alert_sent",
      kind === "resolved" ? "Slack: resolution posted" : "Slack: alert posted",
    );
  } catch (err) {
    console.error("[alerts] unexpected error:", err instanceof Error ? err.message : err);
  }
}

/** Posts a harmless test message so the setup can be checked from Settings. */
export async function sendTestAlert(sentBy: string): Promise<string | null> {
  return postToSlack({
    text: "Website Watch test alert",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Website Watch is connected.* Critical incidents will be posted here.\nTest sent by ${sentBy.replace(/[<>&]/g, "")}.`,
        },
      },
    ],
  });
}
