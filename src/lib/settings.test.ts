import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCertificate } from "./monitoring/evaluate.ts";
import { decideIncident } from "./monitoring/incident-engine.ts";
import { wordpressProblems, type WordPressFacts } from "./monitoring/wordpress.ts";
import { DEFAULT_SETTINGS, parseSettingsForm, settingsFromRow, settingsToRow } from "./settings.ts";

function form(values: Record<string, string>) {
  const all: Record<string, string> = {
    failures_to_open: "2",
    passes_to_resolve: "2",
    default_max_response_ms: "3000",
    ssl_warning_days: "14",
    ssl_failure_days: "3",
    backup_max_age_hours: "48",
    min_php_version: "8.2",
    warn_on_updates: "on",
    summary_enabled: "on",
    summary_weekday: "1",
    summary_hour: "9",
    ...values,
  };
  return (name: string) => all[name] ?? null;
}

test("the form round-trips the defaults", () => {
  assert.deepEqual(parseSettingsForm(form({})), { ok: true, settings: DEFAULT_SETTINGS });
});

test("the form reads changes, including unticked boxes and an empty PHP minimum", () => {
  const r = parseSettingsForm(form({ failures_to_open: "3", min_php_version: "", warn_on_updates: "", summary_weekday: "5" }));
  assert.ok(r.ok);
  assert.equal(r.settings.failuresToOpen, 3);
  assert.equal(r.settings.minPhpVersion, null, "empty skips the PHP check");
  assert.equal(r.settings.warnOnUpdates, false);
  assert.equal(r.settings.summaryWeekday, 5);
});

test("the form rejects out-of-range, non-numeric and inconsistent values", () => {
  const bad = (values: Record<string, string>) => {
    const r = parseSettingsForm(form(values));
    return r.ok ? null : r.field;
  };
  assert.equal(bad({ failures_to_open: "0" }), "failures_to_open");
  assert.equal(bad({ failures_to_open: "2.5" }), "failures_to_open");
  assert.equal(bad({ backup_max_age_hours: "abc" }), "backup_max_age_hours");
  assert.equal(bad({ summary_hour: "24" }), "summary_hour");
  assert.equal(bad({ ssl_failure_days: "14" }), "ssl_failure_days", "failure must be fewer days than warning");
  assert.equal(bad({ min_php_version: "eight" }), "min_php_version");
  assert.equal(bad({ min_php_version: "8.2'; drop table" }), "min_php_version");
});

test("rows from the database fall back to defaults for anything missing or invalid", () => {
  assert.deepEqual(settingsFromRow(null), DEFAULT_SETTINGS);
  const s = settingsFromRow({ failures_to_open: 3, passes_to_resolve: 99, min_php_version: null, warn_on_updates: false });
  assert.equal(s.failuresToOpen, 3);
  assert.equal(s.passesToResolve, 2, "out of range falls back");
  assert.equal(s.minPhpVersion, null);
  assert.equal(s.warnOnUpdates, false);
  assert.deepEqual(settingsFromRow(settingsToRow(s)), s, "round-trips through a row");
});

test("incident thresholds come from Settings", () => {
  const monitor = { name: "Homepage", severity_on_failure: "critical" as const };
  const check = (passed: boolean, i: number) => ({
    status: passed ? ("passed" as const) : ("failed" as const),
    passed,
    checked_at: new Date(Date.UTC(2026, 8, 29, 12, 10 - i)).toISOString(),
    http_status: passed ? 200 : 500,
    error_message: passed ? null : "HTTP 500",
  });
  const twoFailures = [check(false, 0), check(false, 1)];
  assert.equal(decideIncident(monitor, twoFailures, undefined).kind, "open");
  assert.equal(decideIncident(monitor, twoFailures, undefined, { failuresToOpen: 3, passesToResolve: 2 }).kind, "none");
  const onePass = [check(true, 0), check(false, 1)];
  assert.equal(decideIncident(monitor, onePass, { severity: "critical" }, { failuresToOpen: 2, passesToResolve: 1 }).kind, "resolve");
});

test("SSL limits come from Settings", () => {
  const now = new Date("2026-09-29T00:00:00Z");
  const obs = { validTo: new Date("2026-10-19T00:00:00Z"), authorized: true, authorizationError: null, responseTimeMs: 10, error: null };
  assert.equal(evaluateCertificate(obs, now).status, "passed", "20 days left is fine by default (warns at 14)");
  assert.equal(evaluateCertificate(obs, now, { sslWarningDays: 30, sslFailureDays: 3 }).status, "warning");
  assert.equal(evaluateCertificate(obs, now, { sslWarningDays: 30, sslFailureDays: 21 }).status, "failed");
});

test("WordPress rules come from Settings: backup age, PHP minimum, and whether updates warn", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const facts: WordPressFacts = {
    wpVersion: "7.0.5",
    latestWpVersion: "7.1.2",
    phpVersion: "7.4",
    install: { status: "active", defer_wordpress_upgrades_until: null },
    backups: { lastCompletedAt: "2026-09-27T00:00:00Z", latestStatus: "completed", latestAt: null, wordpressVersion: null },
    outdatedPlugins: [{ slug: "x", version: "1", latest: "2" }],
    isWordPress: true,
  };
  const messages = (rules = DEFAULT_SETTINGS) => wordpressProblems(facts, now, rules).map((p) => p.message);
  assert.deepEqual(messages(), [
    "Last completed backup was 60 hours ago",
    "WordPress 7.0.5 (latest is 7.1.2)",
    "PHP 7.4 is below the minimum (8.2)",
    "1 plugin with updates available",
  ]);
  assert.deepEqual(messages({ ...DEFAULT_SETTINGS, backupMaxAgeHours: 72, minPhpVersion: null, warnOnUpdates: false }), []);
  assert.deepEqual(messages({ ...DEFAULT_SETTINGS, minPhpVersion: "7.4", warnOnUpdates: false }), [
    "Last completed backup was 60 hours ago",
  ]);
});
