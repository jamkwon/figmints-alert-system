import { test } from "node:test";
import assert from "node:assert/strict";
import { decideIncident, severityForCheck, titleForCheck } from "./incident-engine.ts";

const monitor = { name: "Contact Page", severity_on_failure: "critical" as const };

type Check = Parameters<typeof decideIncident>[1][number];
const pass = (t: string): Check => ({ status: "passed", passed: true, checked_at: t, http_status: 200, error_message: null });
const fail = (t: string, error = "HTTP 500 Internal Server Error", http: number | null = 500): Check => ({
  status: "failed",
  passed: false,
  checked_at: t,
  http_status: http,
  error_message: error,
});
const slow = (t: string): Check => ({
  status: "warning",
  passed: false,
  checked_at: t,
  http_status: 200,
  error_message: "Response time 4400 ms exceeds 2000 ms threshold",
});

// History is newest first; timestamps sort as strings.
test("no history or a single failure does not open an incident", () => {
  assert.deepEqual(decideIncident(monitor, [], undefined), { kind: "none" });
  assert.deepEqual(decideIncident(monitor, [fail("t2"), pass("t1")], undefined), { kind: "none" });
});

test("two consecutive failures open an incident from the first failure", () => {
  const decision = decideIncident(monitor, [fail("t3"), fail("t2"), pass("t1")], undefined);
  assert.equal(decision.kind, "open");
  if (decision.kind !== "open") return;
  assert.deepEqual(decision.incident, {
    title: "Contact Page returning HTTP 500",
    description: "HTTP 500 Internal Server Error. 2 consecutive failed checks.",
    severity: "critical",
    first_detected_at: "t2",
    last_detected_at: "t3",
  });
});

test("failures separated by a pass do not count as consecutive", () => {
  assert.deepEqual(decideIncident(monitor, [fail("t3"), pass("t2"), fail("t1")], undefined), { kind: "none" });
});

test("slow responses open a warning even on a critical monitor", () => {
  const decision = decideIncident(monitor, [slow("t2"), slow("t1")], undefined);
  assert.equal(decision.kind === "open" && decision.incident.severity, "warning");
  assert.equal(decision.kind === "open" && decision.incident.title, "Contact Page response time above threshold");
});

test("a mixed streak takes the worst severity", () => {
  const decision = decideIncident(monitor, [slow("t2"), fail("t1")], undefined);
  assert.equal(decision.kind === "open" && decision.incident.severity, "critical");
});

test("continued failure updates the open incident", () => {
  const decision = decideIncident(monitor, [fail("t4"), fail("t3"), fail("t2")], { severity: "critical" });
  assert.deepEqual(decision, {
    kind: "update",
    changes: {
      last_detected_at: "t4",
      description: "HTTP 500 Internal Server Error. 3 consecutive failed checks.",
      severity: "critical",
    },
  });
});

test("severity escalates but never downgrades automatically", () => {
  const escalated = decideIncident(monitor, [fail("t3"), slow("t2")], { severity: "warning" });
  assert.equal(escalated.kind === "update" && escalated.changes.severity, "critical");
  const kept = decideIncident(monitor, [slow("t3"), fail("t2")], { severity: "critical" });
  assert.equal(kept.kind === "update" && kept.changes.severity, "critical");
});

test("one success does not resolve; two consecutive successes do", () => {
  assert.deepEqual(decideIncident(monitor, [pass("t3"), fail("t2")], { severity: "critical" }), { kind: "none" });
  assert.deepEqual(decideIncident(monitor, [pass("t4"), pass("t3"), fail("t2")], { severity: "critical" }), {
    kind: "resolve",
    resolvedAt: "t4",
  });
});

test("informational monitors stay informational", () => {
  const info = { ...monitor, severity_on_failure: "informational" as const };
  assert.equal(severityForCheck(slow("t"), info.severity_on_failure), "informational");
  assert.equal(severityForCheck(fail("t"), info.severity_on_failure), "informational");
});

test("titles describe the kind of failure", () => {
  assert.equal(
    titleForCheck(fail("t", 'Expected text "Contact Us" not found', 200), "Contact Page"),
    "Expected content missing on Contact Page",
  );
  assert.equal(titleForCheck(fail("t", "DNS lookup failed (domain not found)", null), "Homepage"), "Homepage is unreachable");
  assert.equal(titleForCheck(fail("t", "HTTP 404 Not Found", 404), "Homepage"), "Homepage returning HTTP 404");
});

test("SSL monitors get certificate-specific titles", () => {
  const ssl = { name: "Homepage", severity_on_failure: "critical" as const, monitor_type: "ssl_expiry" as const };
  const soon: Check = { status: "warning", passed: false, checked_at: "t2", http_status: null, error_message: "SSL certificate expires in 10 days" };
  const warn = decideIncident(ssl, [soon, { ...soon, checked_at: "t1" }], undefined);
  assert.equal(warn.kind === "open" && warn.incident.title, "SSL certificate for Homepage expires soon");
  assert.equal(warn.kind === "open" && warn.incident.severity, "warning");
  const expired: Check = { ...soon, status: "failed", error_message: "SSL certificate expired 2 days ago" };
  const crit = decideIncident(ssl, [expired, { ...expired, checked_at: "t1" }], undefined);
  assert.equal(crit.kind === "open" && crit.incident.title, "SSL certificate problem on Homepage");
  assert.equal(crit.kind === "open" && crit.incident.severity, "critical");
});

test("tracking tag monitors get a tracking-specific title", () => {
  const tags = { name: "Homepage", severity_on_failure: "warning" as const, monitor_type: "tracking_tags" as const };
  const missing: Check = { status: "failed", passed: false, checked_at: "t2", http_status: 200, error_message: "Missing tracking: Meta Pixel" };
  const decision = decideIncident(tags, [missing, { ...missing, checked_at: "t1" }], undefined);
  assert.equal(decision.kind === "open" && decision.incident.title, "Tracking tags missing on Homepage");
  assert.equal(decision.kind === "open" && decision.incident.severity, "warning");
});

test("WordPress health monitors get backup- or update-specific titles", () => {
  const wp = { name: "Main site", severity_on_failure: "critical" as const, monitor_type: "wordpress_health" as const };
  const backup: Check = { status: "failed", passed: false, checked_at: "t2", http_status: 200, error_message: "Latest backup was aborted" };
  const b = decideIncident(wp, [backup, { ...backup, checked_at: "t1" }], undefined);
  assert.equal(b.kind === "open" && b.incident.title, "WP Engine backup problem on Main site");
  assert.equal(b.kind === "open" && b.incident.severity, "critical");
  const updates: Check = { ...backup, status: "warning", error_message: "WordPress 7.0.5 (latest is 7.1.2)" };
  const u = decideIncident(wp, [updates, { ...updates, checked_at: "t1" }], undefined);
  assert.equal(u.kind === "open" && u.incident.title, "WordPress updates needed on Main site");
  assert.equal(u.kind === "open" && u.incident.severity, "warning");
});

test("WordPress PHP errors get their own incident title", () => {
  assert.equal(
    titleForCheck(fail("t", "2 fatal PHP errors in the last 24 hours (Gravity Forms)", 200), "WordPress Health", "wordpress_health"),
    "PHP errors on WordPress Health",
  );
});

test("search visibility and domain expiry get their own incident titles", () => {
  const warning = { ...fail("t", "Domain figmints.com expires in 20 days", null), status: "warning" as const };
  assert.equal(titleForCheck(fail("t", "Page tells search engines not to index it", 200), "Search Visibility", "search_visibility"), "Search engines blocked on Search Visibility");
  assert.equal(titleForCheck({ ...warning, error_message: "Canonical URL points to another domain" }, "Search Visibility", "search_visibility"), "Search visibility issue on Search Visibility");
  assert.equal(titleForCheck(warning, "Domain Expiry", "domain_expiry"), "Domain for Domain Expiry expires soon");
  assert.equal(titleForCheck(fail("t", "Domain figmints.com expired 2 days ago", null), "Domain Expiry", "domain_expiry"), "Domain problem on Domain Expiry");
});
