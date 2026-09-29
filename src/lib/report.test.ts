import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyReport, monthRange, recentMonths, type ReportCheck, type ReportInput } from "./report.ts";

const TZ = "America/New_York";

test("monthRange: calendar months in the app's timezone, across DST", () => {
  const sep = monthRange("2026-09", TZ)!;
  assert.equal(sep.label, "September 2026");
  assert.equal(sep.start.toISOString(), "2026-09-01T04:00:00.000Z", "midnight EDT");
  assert.equal(sep.end.toISOString(), "2026-10-01T04:00:00.000Z");
  const nov = monthRange("2026-11", TZ)!;
  assert.equal(nov.start.toISOString(), "2026-11-01T04:00:00.000Z", "Nov 1 is still EDT");
  assert.equal(nov.end.toISOString(), "2026-12-01T05:00:00.000Z", "Dec 1 is EST");
  assert.equal(monthRange("2026-12", TZ)!.end.toISOString(), "2027-01-01T05:00:00.000Z");
  assert.equal(monthRange("2026-13", TZ), null);
  assert.equal(monthRange("sept", TZ), null);
});

test("recentMonths: this month and the two before, in local time", () => {
  assert.deepEqual(recentMonths(new Date("2026-10-01T02:00:00Z"), TZ), ["2026-09", "2026-08", "2026-07"], "still Sep 30 in New York");
  assert.deepEqual(recentMonths(new Date("2026-01-15T12:00:00Z"), TZ), ["2026-01", "2025-12", "2025-11"]);
});

const month = monthRange("2026-09", TZ)!;
const wpCheck = (checkedAt: string, meta: Record<string, unknown>): ReportCheck => ({
  monitorId: "wp",
  checkedAt,
  status: "passed",
  passed: true,
  errorMessage: null,
  metadata: meta,
});
const plugin = (slug: string, name: string, version: string, latest: string | null = null) => ({
  slug,
  name,
  version,
  latest,
  source: "plugin",
});

const input: ReportInput = {
  month,
  now: new Date("2026-10-02T12:00:00Z"),
  websites: [
    { id: "w1", name: "Main site", url: "https://www.figmints.com/", environment: "production" },
    { id: "w2", name: "Staging", url: "https://figstaging2.wpengine.com/", environment: "staging" },
  ],
  monitors: [
    { id: "home", websiteId: "w1", name: "Homepage", type: "http_status" },
    { id: "stage", websiteId: "w2", name: "Homepage", type: "http_status" },
    { id: "wp", websiteId: "w1", name: "WordPress Health", type: "wordpress_health" },
    { id: "speed", websiteId: "w1", name: "Page Speed", type: "page_speed" },
    { id: "ssl", websiteId: "w1", name: "SSL", type: "ssl_expiry" },
    { id: "dom", websiteId: "w1", name: "Domain", type: "domain_expiry" },
    { id: "vis", websiteId: "w1", name: "Search Visibility", type: "search_visibility" },
  ],
  uptime: [
    { monitorId: "home", checks: 8640, passed: 8631 },
    { monitorId: "stage", checks: 360, passed: 360 },
    { monitorId: "speed", checks: 30, passed: 20 }, // not availability: ignored for uptime
  ],
  checks: [
    wpCheck("2026-09-01T06:00:00Z", {
      wordpress: { version: "7.0.5" },
      plugins: [plugin("gravityforms", "Gravity Forms", "2.10.2"), plugin("wordpress-seo", "Yoast SEO", "27.6"), plugin("akismet", "Akismet", "5.7")],
      plugin_report: { themes: [{ slug: "figpress", name: "Figpress", version: "3.0" }] },
      wpengine: { last_backup_at: "2026-09-01T04:00:00Z" },
      problems: [{ level: "critical", message: "Last completed backup was 60 hours ago" }],
    }),
    wpCheck("2026-09-15T06:00:00Z", {
      wordpress: { version: "7.1.2" },
      plugins: [plugin("gravityforms", "Gravity Forms", "3.1.2")],
      plugin_report: {
        fatal_errors: [{ first_at: "2026-09-14T10:00:00Z", file: "wp-content/plugins/x/x.php", line: 3, message: "boom", count: 2, source: "Gravity Forms" }],
      },
      problems: [],
    }),
    wpCheck("2026-09-30T06:00:00Z", {
      wordpress: { version: "7.1.2" },
      plugins: [plugin("gravityforms", "Gravity Forms", "3.1.2"), plugin("wordpress-seo", "Yoast SEO", "28.5"), plugin("akismet", "Akismet", "5.7", "5.8")],
      plugin_report: {
        themes: [{ slug: "figpress", name: "Figpress", version: "3.1", latest: "3.2" }],
        fatal_errors: [{ first_at: "2026-09-14T10:00:00Z", file: "wp-content/plugins/x/x.php", line: 3, message: "boom", count: 5, source: "Gravity Forms" }],
      },
      wpengine: { last_backup_at: "2026-09-30T04:10:00Z" },
      problems: [],
    }),
    { monitorId: "speed", checkedAt: "2026-09-10T06:00:00Z", status: "passed", passed: true, errorMessage: null, metadata: { score: 58, lab: { lcpMs: 7000 } } },
    { monitorId: "speed", checkedAt: "2026-09-30T06:00:00Z", status: "passed", passed: true, errorMessage: null, metadata: { score: 64, lab: { lcpMs: 6200 } } },
    { monitorId: "ssl", checkedAt: "2026-09-30T06:00:00Z", status: "passed", passed: true, errorMessage: null, metadata: { valid_to: "2026-12-01T00:00:00Z" } },
    { monitorId: "dom", checkedAt: "2026-09-30T06:00:00Z", status: "passed", passed: true, errorMessage: null, metadata: { domain: "figmints.com", expires_at: "2027-02-02T17:30:18.000Z", registrar: "Name.com, Inc." } },
    { monitorId: "vis", checkedAt: "2026-09-12T06:00:00Z", status: "failed", passed: false, errorMessage: "Page tells search engines not to index it", metadata: {} },
    { monitorId: "vis", checkedAt: "2026-09-12T12:00:00Z", status: "passed", passed: true, errorMessage: null, metadata: {} },
  ],
  incidents: [
    { title: "Homepage returning HTTP 503", severity: "critical", firstDetectedAt: "2026-09-12T14:00:00Z", resolvedAt: "2026-09-12T14:45:00Z" },
    { title: "Carried over from August", severity: "warning", firstDetectedAt: "2026-08-30T10:00:00Z", resolvedAt: "2026-09-02T10:00:00Z" },
    { title: "Still open", severity: "warning", firstDetectedAt: "2026-09-29T10:00:00Z", resolvedAt: null },
  ],
};

test("overview: uptime from availability monitors, incidents opened this month, mean time to resolve", () => {
  const r = buildMonthlyReport(input);
  assert.equal(r.inProgress, false);
  assert.equal(r.overview.uptime!.toFixed(3), (((8631 + 360) / (8640 + 360)) * 100).toFixed(3));
  assert.equal(r.overview.checks, 9000, "availability checks only");
  assert.equal(r.overview.incidents, 2, "the one carried over from August isn't counted as new");
  assert.equal(r.overview.meanMinutesToResolve, Math.round((45 + 3 * 24 * 60) / 2), "both resolved in September");
  assert.deepEqual(
    r.websites.map((w) => [w.name, w.environment, w.checks]),
    [
      ["Main site", "production", 8640],
      ["Staging", "staging", 360],
    ],
  );
  assert.equal(r.incidents[0].title, "Carried over from August", "oldest first");
  assert.equal(r.incidents.at(-1)!.minutes, null, "still open");
});

test("WordPress work: updates between the first and last check, backups, PHP errors, what's still pending", () => {
  const [wp] = buildMonthlyReport(input).wordpress;
  assert.equal(wp.website, "Main site");
  assert.deepEqual(wp.core, { from: "7.0.5", to: "7.1.2" });
  assert.deepEqual(wp.pluginUpdates, [
    { name: "Gravity Forms", from: "2.10.2", to: "3.1.2" },
    { name: "Yoast SEO", from: "27.6", to: "28.5" },
  ]);
  assert.deepEqual(wp.themeUpdates, [{ name: "Figpress", from: "3.0", to: "3.1" }]);
  assert.equal(wp.pendingUpdates, 2, "Akismet and Figpress still have updates");
  assert.equal(wp.lastBackupAt, "2026-09-30T04:10:00Z");
  assert.equal(wp.backupProblems, 1);
  assert.deepEqual(wp.phpErrors, [{ source: "Gravity Forms", count: 5 }], "the same error across checks counts once, at its highest");
  assert.equal(wp.fullDetail, true);
});

test("page speed, SSL, domain and search visibility", () => {
  const r = buildMonthlyReport(input);
  assert.deepEqual(r.pageSpeed, [
    { website: "Main site", url: "https://www.figmints.com/", latest: 64, min: 58, max: 64, average: 61, tests: 2, latestLcpMs: 6200 },
  ]);
  assert.deepEqual(r.ssl, [{ website: "Main site", validTo: "2026-12-01T00:00:00Z" }]);
  assert.deepEqual(r.domains, [{ domain: "figmints.com", expiresAt: "2027-02-02T17:30:18.000Z", registrar: "Name.com, Inc." }]);
  assert.deepEqual(r.visibility, [
    { website: "Main site", checks: 2, problems: 1, latestProblem: "Page tells search engines not to index it" },
  ]);
});

test("an empty month and a month in progress", () => {
  const empty = buildMonthlyReport({ ...input, uptime: [], checks: [], incidents: [], now: new Date("2026-09-15T12:00:00Z") });
  assert.equal(empty.inProgress, true);
  assert.equal(empty.overview.uptime, null);
  assert.equal(empty.overview.meanMinutesToResolve, null);
  assert.deepEqual([empty.wordpress, empty.pageSpeed, empty.ssl, empty.domains], [[], [], [], []]);
});

test("plugin updates are counted from the first check with the site plugin's full list", () => {
  // Staging on Sep 28–29: public signals first (no versions), then the plugin, then updates.
  const publicOnly = { wordpress: { version: "7.0.5" }, plugins: [{ slug: "gravityforms", version: null, source: "asset" }] };
  const before = {
    wordpress: { version: "7.0.5" },
    plugins: [plugin("gravityforms", "Gravity Forms", "2.10.2", "3.1.2"), plugin("wordpress-seo", "Yoast SEO", "27.6", "28.5")],
  };
  const after = {
    wordpress: { version: "7.1.2" },
    plugins: [plugin("gravityforms", "Gravity Forms", "3.1.2"), plugin("wordpress-seo", "Yoast SEO", "28.5")],
  };
  const [wp] = buildMonthlyReport({
    ...input,
    checks: [wpCheck("2026-09-28T20:13:00Z", publicOnly), wpCheck("2026-09-28T20:23:00Z", before), wpCheck("2026-09-29T11:51:00Z", after)],
  }).wordpress;
  assert.deepEqual(wp.core, { from: "7.0.5", to: "7.1.2" });
  assert.equal(wp.pluginUpdates.length, 2);
  assert.equal(wp.pendingUpdates, 0);
  assert.equal(wp.fullDetail, true);
});
