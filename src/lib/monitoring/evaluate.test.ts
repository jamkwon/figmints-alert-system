import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCheck, isExpectedStatus, pageContainsText, type HttpObservation, type MonitorRules } from "./evaluate.ts";

const httpMonitor: MonitorRules = {
  monitor_type: "http_status",
  expected_status_code: null,
  expected_text: null,
  max_response_time_ms: null,
};

function obs(overrides: Partial<HttpObservation>): HttpObservation {
  return { httpStatus: 200, statusText: "OK", responseTimeMs: 250.4, body: "<html></html>", error: null, ...overrides };
}

test("default success range is 200-399", () => {
  assert.equal(isExpectedStatus(200, null), true);
  assert.equal(isExpectedStatus(301, null), true);
  assert.equal(isExpectedStatus(399, null), true);
  assert.equal(isExpectedStatus(404, null), false);
  assert.equal(isExpectedStatus(500, null), false);
  assert.equal(isExpectedStatus(199, null), false);
});

test("a configured expected status must match exactly", () => {
  assert.equal(isExpectedStatus(301, 301), true);
  assert.equal(isExpectedStatus(200, 301), false);
});

test("passing HTTP check records status and rounded time", () => {
  const outcome = evaluateCheck(httpMonitor, obs({}));
  assert.deepEqual(outcome, {
    status: "passed",
    passed: true,
    http_status: 200,
    response_time_ms: 250,
    error_message: null,
  });
});

test("server error fails with the status in the message", () => {
  const outcome = evaluateCheck(httpMonitor, obs({ httpStatus: 500, statusText: "Internal Server Error" }));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.error_message, "HTTP 500 Internal Server Error");
});

test("unexpected status explains what was expected", () => {
  const outcome = evaluateCheck({ ...httpMonitor, expected_status_code: 301 }, obs({ httpStatus: 200 }));
  assert.equal(outcome.error_message, "Expected HTTP 301, got HTTP 200 OK");
});

test("network errors fail with the error message and no status", () => {
  const outcome = evaluateCheck(httpMonitor, obs({ httpStatus: null, error: "Connection refused", body: null }));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.http_status, null);
  assert.equal(outcome.error_message, "Connection refused");
});

test("expected content passes when present and fails when missing", () => {
  const monitor: MonitorRules = { ...httpMonitor, monitor_type: "expected_content", expected_text: "Contact Us" };
  assert.equal(evaluateCheck(monitor, obs({ body: "<h1>Contact <b>Us</b></h1>" })).passed, true);
  const missing = evaluateCheck(monitor, obs({ body: "<h1>Page not found</h1>" }));
  assert.equal(missing.status, "failed");
  assert.equal(missing.error_message, 'Expected text "Contact Us" not found');
});

test("expected content is not checked when the status already failed", () => {
  const monitor: MonitorRules = { ...httpMonitor, expected_text: "Contact Us" };
  const outcome = evaluateCheck(monitor, obs({ httpStatus: 404, statusText: "Not Found", body: "" }));
  assert.equal(outcome.error_message, "HTTP 404 Not Found");
});

test("page text matching ignores tags, case, entities and whitespace", () => {
  assert.equal(pageContainsText("<p>Contact&nbsp;<em>us</em>\n today</p>", "contact us"), true);
  assert.equal(pageContainsText("<p>Tom &amp; Jerry</p>", "Tom & Jerry"), true);
  assert.equal(pageContainsText("<p>We&#8217;re open</p>", "We're open"), true);
  assert.equal(pageContainsText("<p>We’re open</p>", "We're open"), true);
});

test("page text matching ignores scripts and styles", () => {
  const html = "<script>const label = 'Get Your Free Estimate';</script><style>.x{}</style><p>Hello</p>";
  assert.equal(pageContainsText(html, "Get Your Free Estimate"), false);
});

test("response time monitors warn when over threshold", () => {
  const monitor: MonitorRules = { ...httpMonitor, monitor_type: "response_time", max_response_time_ms: 2000 };
  assert.equal(evaluateCheck(monitor, obs({ responseTimeMs: 1500 })).status, "passed");
  const slow = evaluateCheck(monitor, obs({ responseTimeMs: 4400 }));
  assert.equal(slow.status, "warning");
  assert.equal(slow.passed, false);
  assert.equal(slow.error_message, "Response time 4400 ms exceeds 2000 ms threshold");
});

test("response time threshold defaults to 3000 ms", () => {
  const monitor: MonitorRules = { ...httpMonitor, monitor_type: "response_time" };
  assert.equal(evaluateCheck(monitor, obs({ responseTimeMs: 2900 })).status, "passed");
  assert.equal(evaluateCheck(monitor, obs({ responseTimeMs: 3100 })).status, "warning");
});

test("slow responses only matter for response time monitors", () => {
  assert.equal(evaluateCheck(httpMonitor, obs({ responseTimeMs: 9000 })).status, "passed");
});
