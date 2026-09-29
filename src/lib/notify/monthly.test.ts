import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyReport, monthRange, type ReportInput } from "../report.ts";
import { MONTHLY_MAX_CLIENTS, buildMonthlyReportsMessage, monthlyPostDue, needsAttention } from "./monthly.ts";

const TZ = "America/New_York";

test("monthlyPostDue: the month that just ended, from the 1st at the set hour for 24 hours", () => {
  // Oct 1, 2026 in New York is EDT (UTC-4): 9:00 local = 13:00 UTC.
  assert.deepEqual(monthlyPostDue(new Date("2026-10-01T12:59:00Z"), TZ, 9), { month: "2026-08", due: false }, "before 9:00 on the 1st");
  assert.deepEqual(monthlyPostDue(new Date("2026-10-01T13:00:00Z"), TZ, 9), { month: "2026-09", due: true });
  assert.deepEqual(monthlyPostDue(new Date("2026-10-02T12:59:00Z"), TZ, 9), { month: "2026-09", due: true }, "catches up for a day");
  assert.deepEqual(monthlyPostDue(new Date("2026-10-02T13:00:00Z"), TZ, 9), { month: "2026-09", due: false });
  assert.deepEqual(monthlyPostDue(new Date("2026-10-15T15:00:00Z"), TZ, 9), { month: "2026-09", due: false }, "mid-month: last month, not due");
  assert.deepEqual(monthlyPostDue(new Date("2027-01-01T14:00:00Z"), TZ, 9), { month: "2026-12", due: true }, "across the year");
  // 00:30 UTC on Oct 1 is still Sep 30 in New York.
  assert.equal(monthlyPostDue(new Date("2026-10-01T00:30:00Z"), TZ, 0).due, false);
});

const month = monthRange("2026-09", TZ)!;
const base: ReportInput = {
  month,
  now: new Date("2026-10-01T13:00:00Z"),
  websites: [{ id: "w", name: "Main site", url: "https://www.figmints.com/", environment: "production" }],
  monitors: [{ id: "home", websiteId: "w", name: "Homepage", type: "http_status" }],
  uptime: [{ monitorId: "home", checks: 8640, passed: 8640 }],
  checks: [],
  incidents: [],
};

test("the message: one line per client, those needing a look first, with report links", () => {
  const healthy = buildMonthlyReport(base);
  const shaky = buildMonthlyReport({ ...base, uptime: [{ monitorId: "home", checks: 8640, passed: 8500 }] });
  assert.equal(needsAttention(healthy), false);
  assert.equal(needsAttention(shaky), true);
  const msg = buildMonthlyReportsMessage(
    "September 2026",
    [
      { clientName: "Acme & Co", url: "https://watch.example/clients/a/report?month=2026-09", report: healthy },
      { clientName: "Figmints", url: null, report: shaky },
    ],
    "https://watch.example",
  );
  const all = JSON.stringify(msg.blocks);
  assert.equal(msg.text, "Monthly reports · September 2026: reports for 2 clients are ready");
  assert.match(all, /:large_orange_circle: \*Figmints\* · 98\.38% uptime · 0 incidents.*:large_green_circle: <https:\/\/watch\.example\/clients\/a\/report\?month=2026-09\|Acme &amp; Co> · 100% uptime/);
  assert.match(all, /Open Website Watch/);
});

test("many clients: at most the limit, then '…and N more'", () => {
  const report = buildMonthlyReport(base);
  const clients = Array.from({ length: MONTHLY_MAX_CLIENTS + 5 }, (_, i) => ({ clientName: `Client ${i}`, url: null, report }));
  const all = JSON.stringify(buildMonthlyReportsMessage("September 2026", clients, null).blocks);
  assert.match(all, /…and 5 more/);
  assert.doesNotMatch(all, /Open Website Watch/, "no button without the app's address");
});
