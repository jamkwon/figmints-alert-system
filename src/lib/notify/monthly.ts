// Monthly reports in Slack: on the 1st, one message linking each client's report
// for the month that just ended, with its headline numbers. Pure (relative
// imports only) so it can be tested. Scheduling and sending live in monthly-send.ts.
import type { MonthlyReport } from "../report.ts";

/** A missed posting (scheduler down) is still sent within this many hours. */
export const MONTHLY_CATCH_UP_HOURS = 24;
/** Clients listed in one message before "…and N more". */
export const MONTHLY_MAX_CLIENTS = 40;

/**
 * The month to post (the one that just ended, as YYYY-MM) and whether it's due:
 * from the 1st at `hour` (APP_TIMEZONE) for MONTHLY_CATCH_UP_HOURS.
 */
export function monthlyPostDue(now: Date, timeZone: string, hour: number): { month: string; due: boolean } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const localHour = Number(p.hour);
  // Hours since the 1st at `hour` this month (negative before it).
  const hoursSince = (day - 1) * 24 + localHour - hour;
  // Before the 1st's posting time, the last posting belongs to the month before.
  const back = hoursSince < 0 ? 2 : 1;
  const d = new Date(Date.UTC(year, month - 1 - back, 1));
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { month: key, due: hoursSince >= 0 && hoursSince < MONTHLY_CATCH_UP_HOURS };
}

export interface ClientReportLine {
  clientName: string;
  /** Link to the client's report for the month, when the app's address is known. */
  url: string | null;
  report: MonthlyReport;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Needs a look: uptime under 99.9%, a backup problem, PHP errors, or a search/form problem. */
export function needsAttention(r: MonthlyReport): boolean {
  return (
    (r.overview.uptime !== null && r.overview.uptime < 99.9) ||
    r.wordpress.some((w) => w.backupProblems > 0 || w.phpErrors.length > 0) ||
    r.visibility.some((v) => v.problems > 0) ||
    r.forms.some((f) => f.problems > 0)
  );
}

function line(c: ClientReportLine): string {
  const r = c.report;
  const updates = r.wordpress.reduce((n, w) => n + w.pluginUpdates.length + w.themeUpdates.length + (w.core ? 1 : 0), 0);
  const uptime = r.overview.uptime === null ? "no uptime data" : `${r.overview.uptime === 100 ? "100" : r.overview.uptime.toFixed(2)}% uptime`;
  const parts = [uptime, plural(r.overview.incidents, "incident")];
  if (r.wordpress.length > 0) parts.push(plural(updates, "WordPress update"));
  const name = c.url ? `<${c.url}|${esc(c.clientName)}>` : `*${esc(c.clientName)}*`;
  return `${needsAttention(r) ? ":large_orange_circle:" : ":large_green_circle:"} ${name} · ${parts.join(" · ")}`;
}

/** One Slack message for the month: a line per client, most in need of a look first. */
export function buildMonthlyReportsMessage(monthLabel: string, clients: ClientReportLine[], appUrl: string | null): { text: string; blocks: unknown[] } {
  const sorted = [...clients].sort(
    (a, b) => Number(needsAttention(b.report)) - Number(needsAttention(a.report)) || a.clientName.localeCompare(b.clientName),
  );
  const shown = sorted.slice(0, MONTHLY_MAX_CLIENTS);
  const more = sorted.length - shown.length;
  const title = `Monthly reports · ${monthLabel}`;
  // Slack sections hold up to 3000 characters: several lines per section.
  const sections: string[] = [];
  let current = "";
  for (const l of shown.map(line)) {
    if (current.length + l.length + 1 > 2800) {
      sections.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + l;
  }
  if (current) sections.push(current);
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: title } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: clients.length
          ? `Reports for ${plural(clients.length, "client")} are ready. Open one, then *Print / Save as PDF* to send it.`
          : "No active clients to report on.",
      },
    },
    { type: "divider" },
    ...sections.map((text) => ({ type: "section", text: { type: "mrkdwn", text } })),
  ];
  if (more > 0) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `…and ${more} more: see *Clients* in Website Watch.` }] });
  if (appUrl) {
    blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Website Watch" }, url: appUrl }] });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: ":large_orange_circle: needs a look (uptime under 99.9%, backups, PHP errors, search or form problems)" }],
  });
  return { text: `${title}: reports for ${plural(clients.length, "client")} are ready`, blocks };
}
