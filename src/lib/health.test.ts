import { test } from "node:test";
import assert from "node:assert/strict";
import { failingSince, monitorHealth, rollUpHealth, worstHealth } from "./health.ts";
import type { Incident, Monitor, MonitorCheckSummary } from "./types.ts";

const monitor: Monitor = {
  id: "m1",
  website_id: "w1",
  name: "Homepage",
  monitor_type: "http_status",
  target_url: "https://example.com/",
  expected_status_code: null,
  expected_text: null,
  max_response_time_ms: null,
  interval_minutes: 5,
  severity_on_failure: "critical",
  active: true,
  last_checked_at: null,
  next_check_at: null,
  created_at: "",
  updated_at: "",
};

function summary(last_status: MonitorCheckSummary["last_status"]): MonitorCheckSummary {
  return {
    monitor_id: "m1",
    last_status,
    last_result_at: null,
    last_http_status: null,
    last_response_time_ms: null,
    last_error_message: null,
    last_success_at: null,
    last_metadata: null,
  };
}

function incident(overrides: Partial<Incident>): Incident {
  return {
    id: "i1",
    client_id: "c1",
    website_id: "w1",
    monitor_id: "m1",
    title: "Problem",
    description: "",
    severity: "critical",
    status: "open",
    first_detected_at: "",
    last_detected_at: "",
    resolved_at: null,
    assigned_team: "unassigned",
    internal_notes: "",
    snoozed_until: null,
    alerted_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

test("monitor health follows the latest check when there is no incident", () => {
  assert.equal(monitorHealth(monitor, summary("passed"), []), "healthy");
  assert.equal(monitorHealth(monitor, summary("failed"), []), "warning");
  assert.equal(monitorHealth(monitor, summary("warning"), []), "warning");
  assert.equal(monitorHealth(monitor, summary(null), []), "unknown");
  assert.equal(monitorHealth(monitor, undefined, []), "unknown");
});

test("an open incident's severity overrides the latest check", () => {
  const open = incident({ severity: "critical", status: "open" });
  assert.equal(monitorHealth(monitor, summary("passed"), [open]), "critical");
  const investigating = incident({ severity: "warning", status: "investigating" });
  assert.equal(monitorHealth(monitor, summary("failed"), [investigating]), "warning");
});

test("snoozed and maintenance incidents show as informational", () => {
  const snoozed = incident({ status: "snoozed" });
  const maintenance = incident({ status: "expected_maintenance" });
  assert.equal(monitorHealth(monitor, summary("failed"), [snoozed]), "informational");
  assert.equal(monitorHealth(monitor, summary("failed"), [maintenance]), "informational");
});

test("resolved and ignored incidents fall back to the latest check", () => {
  const resolved = incident({ status: "resolved" });
  const ignored = incident({ status: "ignored" });
  assert.equal(monitorHealth(monitor, summary("passed"), [resolved, ignored]), "healthy");
});

test("inactive monitors or parents are inactive regardless of results", () => {
  assert.equal(monitorHealth({ ...monitor, active: false }, summary("failed"), []), "inactive");
  assert.equal(monitorHealth(monitor, summary("failed"), [incident({})], false), "inactive");
});

test("worst health ignores inactive and defaults to unknown", () => {
  assert.equal(worstHealth([]), "unknown");
  assert.equal(worstHealth(["inactive"]), "unknown");
  assert.equal(worstHealth(["healthy", "warning", "inactive"]), "warning");
  assert.equal(worstHealth(["healthy", "unknown"]), "unknown");
  assert.equal(worstHealth(["informational", "critical"]), "critical");
});

test("roll-up includes incidents not tied to a monitor", () => {
  const clientLevel = incident({ monitor_id: null, severity: "warning" });
  assert.equal(rollUpHealth(true, ["healthy"], [clientLevel]), "warning");
  assert.equal(rollUpHealth(true, ["healthy", "healthy"], []), "healthy");
  assert.equal(rollUpHealth(false, ["critical"], [clientLevel]), "inactive");
});

test("failing since finds the start of the current failure streak", () => {
  const check = (checked_at: string, passed: boolean) => ({ checked_at, passed });
  assert.equal(failingSince([]), null);
  assert.equal(failingSince([check("t3", true), check("t2", false)]), null);
  assert.equal(failingSince([check("t3", false), check("t2", false), check("t1", true)]), "t2");
  assert.equal(failingSince([check("t2", false), check("t1", false)]), "t1");
});
