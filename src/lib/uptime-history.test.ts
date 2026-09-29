import { test } from "node:test";
import assert from "node:assert/strict";
import { countByDay, dayBars, daysBetween, dayTone, overallUptime, recentDays } from "./uptime-history.ts";

const TZ = "America/New_York";

test("recentDays: local dates ending today, oldest first", () => {
  // 02:00 UTC on Oct 1 is still Sep 30 in New York.
  assert.deepEqual(recentDays(new Date("2026-10-01T02:00:00Z"), 3, TZ), ["2026-09-28", "2026-09-29", "2026-09-30"]);
  assert.equal(recentDays(new Date("2026-10-01T12:00:00Z"), 90, TZ).length, 90);
  assert.deepEqual(recentDays(new Date("2026-03-01T12:00:00Z"), 2, TZ), ["2026-02-28", "2026-03-01"], "across a month end");
});

test("daysBetween lists every date, inclusive", () => {
  assert.deepEqual(daysBetween("2026-09-29", "2026-10-02"), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(daysBetween("2026-10-01", "2026-10-01"), ["2026-10-01"]);
});

test("dayBars adds up monitors per day and leaves empty days empty", () => {
  const bars = dayBars(
    ["2026-09-28", "2026-09-29", "2026-09-30"],
    [
      { day: "2026-09-29", checks: 288, passed: 288 },
      { day: "2026-09-29", checks: 96, passed: 92 },
      { day: "2026-09-30", checks: 100, passed: 99 },
    ],
  );
  assert.deepEqual(bars[0], { day: "2026-09-28", checks: 0, passed: 0, uptime: null });
  assert.equal(bars[1].checks, 384);
  assert.equal(bars[1].uptime!.toFixed(2), "98.96");
  assert.equal(overallUptime(bars)!.toFixed(2), (((288 + 92 + 99) / 484) * 100).toFixed(2));
  assert.equal(overallUptime([]), null);
});

test("dayTone: up, blip, degraded, down, no data", () => {
  assert.equal(dayTone(null), "none");
  assert.equal(dayTone(100), "up");
  assert.equal(dayTone(99.3), "blip");
  assert.equal(dayTone(97), "degraded");
  assert.equal(dayTone(80), "down");
});

test("countByDay groups checks by local day", () => {
  const counts = countByDay(
    [
      { checked_at: "2026-09-30T03:30:00Z", passed: true }, // Sep 29, 11:30 pm in New York
      { checked_at: "2026-09-30T04:30:00Z", passed: false }, // Sep 30, 12:30 am
      { checked_at: "2026-09-30T12:00:00Z", passed: true },
    ],
    TZ,
  );
  assert.deepEqual(
    counts.sort((a, b) => a.day.localeCompare(b.day)),
    [
      { day: "2026-09-29", checks: 1, passed: 1 },
      { day: "2026-09-30", checks: 2, passed: 1 },
    ],
  );
});
