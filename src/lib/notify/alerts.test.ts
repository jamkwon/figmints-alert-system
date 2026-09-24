import { test } from "node:test";
import assert from "node:assert/strict";
import { alertFor, buildSlackMessage, type AlertContext } from "./alerts.ts";

const critical = { severity: "critical" as const, status: "open" as const, alerted_at: null };

test("critical incidents alert once when opened, escalated or back from snooze", () => {
  assert.equal(alertFor("opened", critical), "opened");
  assert.equal(alertFor("escalated", { ...critical, status: "investigating" }), "escalated");
  assert.equal(alertFor("snooze_ended", critical), "reopened");
  assert.equal(alertFor("opened", { ...critical, alerted_at: "t" }), null);
  assert.equal(alertFor("snooze_ended", { ...critical, alerted_at: "t" }), null);
});

test("warnings and quiet statuses never alert", () => {
  assert.equal(alertFor("opened", { ...critical, severity: "warning" }), null);
  assert.equal(alertFor("opened", { ...critical, severity: "informational" }), null);
  assert.equal(alertFor("opened", { ...critical, status: "expected_maintenance" }), null);
  assert.equal(alertFor("opened", { ...critical, status: "snoozed" }), null);
  assert.equal(alertFor("opened", { ...critical, status: "ignored" }), null);
});

test("resolved messages go only to incidents that were alerted", () => {
  assert.equal(alertFor("resolved", { ...critical, status: "resolved", alerted_at: "t" }), "resolved");
  assert.equal(alertFor("resolved", { ...critical, status: "resolved" }), null);
  assert.equal(alertFor("resolved", { severity: "warning", status: "resolved", alerted_at: "t" }), "resolved");
});

const ctx: AlertContext = {
  kind: "opened",
  incident: {
    id: "abc",
    title: "Contact Page returning HTTP 500",
    severity: "critical",
    first_detected_at: "2026-09-26T14:00:00Z",
    resolved_at: null,
  },
  clientName: "Integrity Painting",
  monitorName: "Contact Page",
  targetUrl: "https://example.com/contact",
  error: "HTTP 500 Internal Server Error",
  appUrl: "https://figmints-alert-system.vercel.app/",
};

test("alert message uses the [CRITICAL] Client — Problem format with a link", () => {
  const msg = buildSlackMessage(ctx);
  assert.equal(msg.text, "[CRITICAL] Integrity Painting — Contact Page returning HTTP 500");
  const json = JSON.stringify(msg.blocks);
  assert.match(json, /HTTP 500 Internal Server Error/);
  assert.match(json, /https:\/\/figmints-alert-system\.vercel\.app\/incidents\/abc/);
  assert.match(json, /Open incident/);
});

test("resolved message shows duration and who resolved it", () => {
  const msg = buildSlackMessage({
    ...ctx,
    kind: "resolved",
    actor: "jane@figmints.com",
    incident: { ...ctx.incident, resolved_at: "2026-09-26T14:45:00Z" },
  });
  assert.equal(msg.text, "[RESOLVED] Integrity Painting — Contact Page returning HTTP 500");
  const json = JSON.stringify(msg.blocks);
  assert.match(json, /45 min/);
  assert.match(json, /Resolved by jane@figmints.com/);
});

test("user-controlled text is escaped and the button is dropped without an app URL", () => {
  const msg = buildSlackMessage({ ...ctx, clientName: "A <b> & Co", appUrl: null });
  const json = JSON.stringify(msg.blocks);
  assert.match(json, /A &lt;b&gt; &amp; Co/);
  assert.doesNotMatch(json, /Open incident/);
});
