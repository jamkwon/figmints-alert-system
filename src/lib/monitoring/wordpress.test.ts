import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  detectWordPress,
  evaluateWordPress,
  matchInstall,
  summarizeBackups,
  wordpressProblems,
  type WordPressFacts,
  type WpeInstall,
} from "./wordpress.ts";

const PAGE = `
  <link rel="stylesheet" href="https://site.com/wp-includes/css/dist/block-library/style.min.css?ver=7.0.5">
  <script src="https://site.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
  <link href="https://site.com/wp-content/themes/figpress-child/style.css?ver=1.2">
  <link href="https://site.com/wp-content/themes/figpress/style.css?ver=1.0">
  <script src="https://site.com/wp-content/plugins/gravityforms/js/x.js?ver=2.10.2"></script>
  <script src="https://site.com/wp-content/plugins/gravityforms/js/y.js?ver=3f278756f0a3032b"></script>
  <script src="https://site.com/wp-content/plugins/the-events-calendar/app.js?ver=da75d0bdea6d"></script>`;

test("detects version (feed first), themes and plugins from public signals", () => {
  const signals = detectWordPress(PAGE, "<generator>https://wordpress.org/?v=7.0.5</generator>", ["wp/v2", "yoast/v1", "redirection/v1"]);
  assert.equal(signals.isWordPress, true);
  assert.equal(signals.version, "7.0.5");
  assert.equal(signals.versionSource, "feed");
  assert.deepEqual(signals.themes, ["figpress-child", "figpress"]);
  assert.deepEqual(
    signals.plugins.map((p) => [p.slug, p.version, p.source]),
    [
      ["gravityforms", "2.10.2", "asset"],
      ["redirection", null, "rest"],
      ["the-events-calendar", null, "asset"],
      ["wordpress-seo", null, "rest"],
    ],
  );
});

test("falls back to meta generator, then asset versions", () => {
  assert.equal(detectWordPress(`<meta name="generator" content="WordPress 6.9.1" />`, null, null).versionSource, "meta");
  const fromAssets = detectWordPress(PAGE, null, null);
  assert.equal(fromAssets.version, "7.0.5");
  assert.equal(fromAssets.versionSource, "assets");
});

test("a non-WordPress page isn't WordPress", () => {
  const s = detectWordPress("<html><body>Hello</body></html>", null, null);
  assert.equal(s.isWordPress, false);
  assert.equal(s.version, null);
});

test("versions compare numerically", () => {
  assert.ok(compareVersions("7.0.5", "7.1.2") < 0);
  assert.ok(compareVersions("7.10", "7.9") > 0);
  assert.equal(compareVersions("7.1", "7.1.0"), 0);
  assert.ok(compareVersions("8.1.30", "8.2") < 0);
});

const install = (over: Partial<WpeInstall>): WpeInstall => ({
  id: "i1",
  name: "clientprod",
  environment: "production",
  status: "active",
  php_version: "8.3",
  wp_version: "7.1.2",
  primary_domain: "www.client.com",
  cname: "clientprod.wpengine.com",
  defer_wordpress_upgrades_until: null,
  ...over,
});

test("installs match by primary domain (ignoring www), then cname", () => {
  const installs = [install({ id: "a", primary_domain: "www.client.com" }), install({ id: "b", primary_domain: null, cname: "clientstg.wpengine.com" })];
  assert.equal(matchInstall(installs, "client.com")?.id, "a");
  assert.equal(matchInstall(installs, "www.client.com")?.id, "a");
  assert.equal(matchInstall(installs, "clientstg.wpengine.com")?.id, "b");
  assert.equal(matchInstall(installs, "other.com"), null);
});

test("backup summary finds the last completed and the latest backup", () => {
  const s = summarizeBackups([
    { id: "1", status: "completed", create_time: "2026-09-23T02:00:00Z", complete_time: "2026-09-23T02:10:00Z", wordpress_version: null },
    { id: "2", status: "aborted", create_time: "2026-09-24T02:00:00Z", complete_time: null, wordpress_version: null },
    { id: "3", status: "completed", create_time: "2026-09-22T02:00:00Z", complete_time: "2026-09-22T02:09:00Z", wordpress_version: null },
  ]);
  assert.deepEqual(s, { lastCompletedAt: "2026-09-23T02:10:00Z", latestStatus: "aborted", latestAt: "2026-09-24T02:00:00Z", wordpressVersion: null });
});

const now = new Date("2026-09-24T12:00:00Z");
const healthy: WordPressFacts = {
  wpVersion: "7.1.2",
  latestWpVersion: "7.1.2",
  phpVersion: "8.3",
  install: { status: "active", defer_wordpress_upgrades_until: null },
  backups: { lastCompletedAt: "2026-09-24T02:10:00Z", latestStatus: "completed", latestAt: "2026-09-24T02:00:00Z", wordpressVersion: "7.1.2" },
  outdatedPlugins: [],
  isWordPress: true,
};

test("a healthy site has no problems and passes", () => {
  assert.deepEqual(wordpressProblems(healthy, now), []);
  assert.equal(evaluateWordPress([], 900, 200).status, "passed");
});

test("backups older than 48 hours, missing or aborted are critical", () => {
  const old = wordpressProblems({ ...healthy, backups: { ...healthy.backups!, lastCompletedAt: "2026-09-21T12:00:00Z" } }, now);
  assert.deepEqual(old, [{ level: "critical", message: "Last completed backup was 72 hours ago" }]);
  const none = wordpressProblems({ ...healthy, backups: { lastCompletedAt: null, latestStatus: null, latestAt: null, wordpressVersion: null } }, now);
  assert.equal(none[0].message, "No completed WP Engine backup found");
  const aborted = wordpressProblems({ ...healthy, backups: { ...healthy.backups!, latestStatus: "aborted" } }, now);
  assert.equal(aborted[0].message, "Latest backup was aborted");
  const outcome = evaluateWordPress(aborted, 900, 200);
  assert.equal(outcome.status, "failed");
});

test("outdated core, PHP and plugins are warnings; deferred upgrades are respected", () => {
  const problems = wordpressProblems(
    {
      ...healthy,
      wpVersion: "7.0.5",
      phpVersion: "8.1",
      outdatedPlugins: [{ slug: "redirection", version: "5.9", latest: "5.10.1" }],
    },
    now,
  );
  assert.deepEqual(
    problems.map((p) => `${p.level}: ${p.message}`),
    [
      "warning: WordPress 7.0.5 (latest is 7.1.2)",
      "warning: PHP 8.1 is below the minimum (8.2)",
      "warning: 1 plugin with updates available",
    ],
  );
  const outcome = evaluateWordPress(problems, 900, 200);
  assert.equal(outcome.status, "warning");
  assert.equal(outcome.error_message, "WordPress 7.0.5 (latest is 7.1.2); PHP 8.1 is below the minimum (8.2); 1 plugin with updates available");
  const deferred = wordpressProblems(
    { ...healthy, wpVersion: "7.0.5", install: { status: "active", defer_wordpress_upgrades_until: "2026-10-01T00:00:00Z" } },
    now,
  );
  assert.deepEqual(deferred, []);
});

test("critical problems are listed first", () => {
  const outcome = evaluateWordPress(
    [
      { level: "warning", message: "WordPress 7.0.5 (latest is 7.1.2)" },
      { level: "critical", message: "Latest backup was aborted" },
    ],
    1,
    200,
  );
  assert.equal(outcome.error_message, "Latest backup was aborted; WordPress 7.0.5 (latest is 7.1.2)");
});

test("public-only sites without WordPress signals get a warning", () => {
  const p = wordpressProblems({ ...healthy, install: null, backups: null, isWordPress: false, wpVersion: null }, now);
  assert.deepEqual(p, [{ level: "warning", message: "WordPress not detected on this page" }]);
});

test("summarizeBackups handles the API's zero create_time and reads the WordPress version", () => {
  const zero = "0001-01-01T00:00:00.000Z";
  const s = summarizeBackups([
    { id: "1", status: "completed", create_time: zero, complete_time: "2026-09-27T04:18:00Z", wordpress_version: "7.0.4" },
    { id: "2", status: "completed", create_time: zero, complete_time: "2026-09-28T04:23:00Z", wordpress_version: "7.0.5" },
  ]);
  assert.deepEqual(s, {
    lastCompletedAt: "2026-09-28T04:23:00Z",
    latestStatus: "completed",
    latestAt: "2026-09-28T04:23:00Z",
    wordpressVersion: "7.0.5",
  });
});
