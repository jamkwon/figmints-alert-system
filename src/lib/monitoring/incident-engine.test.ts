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
