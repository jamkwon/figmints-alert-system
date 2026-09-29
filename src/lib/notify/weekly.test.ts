import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklySummary, summaryWeek, type SummaryMonitor } from "./weekly.ts";

const TZ = "America/New_York";

test("summaryWeek: due from the scheduled time (default Monday 9:00 local) for 24 hours", () => {
  // Monday Sep 28, 2026, 8:59 and 9:00 in New York (EDT, UTC-4).
  assert.deepEqual(summaryWeek(new Date("2026-09-28T12:59:00Z"), TZ), { weekStart: "2026-09-21", due: false });
  assert.deepEqual(summaryWeek(new Date("2026-09-28T13:00:00Z"), TZ), { weekStart: "2026-09-28", due: true });
  // A scheduler that was down catches up until Tuesday 8:59, not later.
  assert.deepEqual(summaryWeek(new Date("2026-09-29T12:59:00Z"), TZ), { weekStart: "2026-09-28", due: true });
  assert.deepEqual(summaryWeek(new Date("2026-09-29T13:00:00Z"), TZ), { weekStart: "2026-09-28", due: false });
  // Sunday 11 pm local is still that week; UTC is already Monday.
  assert.deepEqual(summaryWeek(new Date("2026-10-05T03:30:00Z"), TZ), { weekStart: "2026-09-28", due: false });
});

test("summaryWeek: another day and time from Settings", () => {
  // Friday (5) at 16:00: Friday Oct 2, 2026, 4 pm New York = 20:00 UTC.
  assert.deepEqual(summaryWeek(new Date("2026-10-02T19:59:00Z"), TZ, 5, 16), { weekStart: "2026-09-25", due: false });
  assert.deepEqual(summaryWeek(new Date("2026-10-02T20:00:00Z"), TZ, 5, 16), { weekStart: "2026-10-02", due: true });
  // Changing the day mid-week to one that already passed doesn't send an extra summary.
  assert.deepEqual(summaryWeek(new Date("2026-09-30T15:00:00Z"), TZ, 1, 9), { weekStart: "2026-09-28", due: false });
  // Sunday (7) at 0:00.
  assert.deepEqual(summaryWeek(new Date("2026-10-04T04:00:00Z"), TZ, 7, 0), { weekStart: "2026-10-04", due: true });
});

const now = new Date("2026-09-28T13:00:00Z");
const base: SummaryMonitor = {
  clientName: "Figmints",
  websiteUrl: "https://www.figmints.com/",
  environment: "production",
  monitorType: "http_status",
  lastStatus: "passed",
  lastErrorMessage: null,
  metadata: null,
  checks7d: 1000,
  passed7d: 999,
};

function text(summary: ReturnType<typeof buildWeeklySummary>): string {
  return JSON.stringify(summary.blocks);
}

test("an all-clear week says so", () => {
  const s = buildWeeklySummary({ monitors: [base], incidents: [], now, appUrl: null });
  assert.equal(s.hasIssues, false);
  assert.match(text(s), /All clear/);
  assert.match(s.text, /1 website · uptime 99\.90% \(7 days\) · 0 incidents this week, 0 still open/);
});

test("lists incidents, backups, certificates, WordPress updates, links and tags", () => {
  const monitors: SummaryMonitor[] = [
    base,
    {
      ...base,
      clientName: "Blue Finch <Bakery>",
      websiteUrl: "https://bluefinch.example/",
      environment: "staging",
      monitorType: "wordpress_health",
      metadata: {
        wordpress: { version: "7.0.5", latest: "7.1.2", source: "plugin" },
        plugins: [
          { slug: "gravityforms", name: "Gravity Forms: Stripe", version: "2.10.2", latest: "3.1.2", source: "plugin" },
          { slug: "akismet", name: "Akismet", version: "5.7.2", latest: null, source: "plugin" },
        ],
        plugin_report: {
          themes: [{ slug: "kadence", name: "Kadence", version: "1.2", latest: "1.3", active: true }],
          fatal_errors: [
            { last_at: "2026-09-27T10:00:00Z", count: 2, message: "x", file: "f", line: 1, source: "Gravity Forms" },
            { last_at: "2026-09-26T10:00:00Z", count: 1, message: "y", file: "g", line: 2, source: "Kadence" },
          ],
        },
        problems: [
          { level: "critical", message: "Last completed backup was 60 hours ago" },
          { level: "critical", message: "2 fatal PHP errors in the last 24 hours (Gravity Forms)" },
        ],
      },
    },
    { ...base, monitorType: "ssl_expiry", metadata: { valid_to: "2026-10-10T00:00:00Z", days_left: 12 } },
    { ...base, monitorType: "broken_links", metadata: { links_checked: 40, broken_links: [{ url: "x" }, { url: "y" }] } },
    {
      ...base,
      monitorType: "tracking_tags",
      metadata: { tags_found: { gtm: ["GTM-1"] }, tags_expected: ["gtm", "ga4"] },
    },
  ];
  const s = buildWeeklySummary({
    monitors,
    incidents: [
      { clientName: "Acme", monitorType: "http_status", title: "Homepage down", severity: "critical", resolved: false, firstDetectedAt: "2026-09-27T10:00:00Z" },
      { clientName: "Acme", monitorType: "http_status", title: "Old one", severity: "warning", resolved: true, firstDetectedAt: "2026-09-01T10:00:00Z" },
      { clientName: "Blue Finch", monitorType: "wordpress_health", title: "WordPress updates needed", severity: "warning", resolved: false, firstDetectedAt: "2026-09-27T10:00:00Z" },
    ],
    now,
    appUrl: "https://watch.example",
  });
  const all = text(s);
  assert.equal(s.hasIssues, true);
  assert.match(all, /Needs attention now.*Acme\* Homepage down/);
  assert.doesNotMatch(all, /Old one/, "resolved incidents aren't listed");
  assert.doesNotMatch(all, /WordPress updates needed/, "warnings with their own section aren't repeated as incidents");
  assert.match(all, /Backups.*Last completed backup was 60 hours ago/);
  assert.doesNotMatch(all, /Backups[^"]*fatal PHP errors/, "only backup problems are listed under Backups");
  assert.match(all, /PHP errors \(last 7 days\).*3 fatal errors \(Gravity Forms ×2, Kadence ×1\), last Sep 27/);
  assert.match(all, /Blue Finch &lt;Bakery&gt;\* bluefinch\.example \(staging\)/, "names are escaped; staging is marked");
  assert.match(all, /WordPress 7\.0\.5 → 7\.1\.2 · 1 plugin update \(Gravity Forms\) · 1 theme update/);
  assert.match(all, /figmints\.com: expires .* \(12 days\)/);
  assert.match(all, /2 broken links/);
  assert.match(all, /missing Google Analytics 4|missing GA4/);
  assert.match(all, /Open Website Watch/);
  assert.match(s.text, /2 incidents this week, 2 still open/);
});

test("long sections are cut with '…and N more'", () => {
  const monitors = Array.from({ length: 40 }, (_, i) => ({
    ...base,
    clientName: `Client ${i}`,
    websiteUrl: `https://site${i}.example/`,
    monitorType: "broken_links" as const,
    metadata: { links_checked: 10, broken_links: [{ url: "x" }] },
  }));
  const all = text(buildWeeklySummary({ monitors, incidents: [], now, appUrl: null }));
  assert.match(all, /…and 25 more/);
});
