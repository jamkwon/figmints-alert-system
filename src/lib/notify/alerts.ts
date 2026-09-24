// Alert rules and Slack message formatting. Pure (relative imports only) so both
// can be tested directly. Sending lives in send.ts.
import { formatDateTime, formatDuration } from "../format.ts";
import type { Incident } from "../types.ts";

/** Something that happened to an incident that might be worth a Slack message. */
export type IncidentChange = "opened" | "escalated" | "snooze_ended" | "resolved";

export type AlertKind = "opened" | "escalated" | "reopened" | "resolved";

type AlertInput = Pick<Incident, "severity" | "status" | "alerted_at">;

/**
 * Critical only, and each incident alerts at most once:
 * - a Critical incident that's open or being investigated alerts once (opened,
 *   escalated from Warning, or back from a snooze);
 * - "resolved" is only sent for incidents that were alerted;
 * - Warnings, Expected Maintenance, Snoozed and Ignored never alert.
 */
export function alertFor(change: IncidentChange, incident: AlertInput): AlertKind | null {
  if (change === "resolved") return incident.alerted_at ? "resolved" : null;
  if (incident.severity !== "critical") return null;
  if (incident.status !== "open" && incident.status !== "investigating") return null;
  if (incident.alerted_at) return null;
  return change === "snooze_ended" ? "reopened" : change;
}

export interface AlertContext {
  kind: AlertKind;
  incident: Pick<Incident, "id" | "title" | "severity" | "first_detected_at" | "resolved_at">;
  clientName: string;
  monitorName: string | null;
  targetUrl: string | null;
  error: string | null;
  /** Base URL of the app for the "Open incident" button; omitted when unknown. */
  appUrl: string | null;
  /** Who resolved it, for manual resolutions. */
  actor?: string | null;
}

const HEADLINES: Record<AlertKind, { emoji: string; label: string; note?: string }> = {
  opened: { emoji: ":red_circle:", label: "CRITICAL" },
  escalated: { emoji: ":red_circle:", label: "CRITICAL", note: "Escalated from Warning" },
  reopened: { emoji: ":red_circle:", label: "CRITICAL", note: "Still failing after snooze" },
  resolved: { emoji: ":large_green_circle:", label: "RESOLVED" },
};

/** Slack's mrkdwn treats &, < and > specially; escape anything we didn't write. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack Block Kit message, with a plain-text fallback for notifications. */
export function buildSlackMessage(ctx: AlertContext): { text: string; blocks: unknown[] } {
  const head = HEADLINES[ctx.kind];
  const title = `[${head.label}] ${ctx.clientName} — ${ctx.incident.title}`;
  const link = ctx.appUrl ? `${ctx.appUrl.replace(/\/$/, "")}/incidents/${ctx.incident.id}` : null;

  const fields: string[] = [`*Client*\n${esc(ctx.clientName)}`];
  if (ctx.monitorName) fields.push(`*Monitor*\n${esc(ctx.monitorName)}`);
  fields.push(`*First detected*\n${formatDateTime(ctx.incident.first_detected_at)}`);
  if (ctx.kind === "resolved" && ctx.incident.resolved_at) {
    fields.push(`*Duration*\n${formatDuration(ctx.incident.first_detected_at, ctx.incident.resolved_at)}`);
  } else if (ctx.error) {
    // Slack limits field length; errors are short, but be safe.
    const error = ctx.error.length > 500 ? `${ctx.error.slice(0, 500)}…` : ctx.error;
    fields.push(`*Error*\n${esc(error)}`);
  }

  const context: string[] = [];
  if (head.note) context.push(head.note);
  if (ctx.kind === "resolved") context.push(ctx.actor ? `Resolved by ${esc(ctx.actor)}` : "Resolved automatically after 2 successful checks");
  if (ctx.targetUrl) context.push(`<${ctx.targetUrl}|${esc(ctx.targetUrl.replace(/^https?:\/\//, ""))}>`);

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${head.emoji} *${esc(title)}*` } },
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
  ];
  if (context.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: context.join("  ·  ") }] });
  if (link) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open incident" }, url: link }],
    });
  }
  return { text: title, blocks };
}
