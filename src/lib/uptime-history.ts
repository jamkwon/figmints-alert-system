// Uptime history: one bar per day (like public status pages), from per-day check
// counts. Pure, so it can be tested.

export interface DayCount {
  /** YYYY-MM-DD in the app's timezone. */
  day: string;
  checks: number;
  passed: number;
}

export interface DayBar extends DayCount {
  /** Percent, or null on days without checks. */
  uptime: number | null;
}

export type DayTone = "none" | "up" | "blip" | "degraded" | "down";

/** Local dates (YYYY-MM-DD in `timeZone`) of the `days` days ending today, oldest first. */
export function recentDays(now: Date, days: number, timeZone: string): string[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10),
  );
}

/** Every date from `start` to `end` (YYYY-MM-DD, inclusive). */
export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** One bar per day, adding up all the given monitors' counts; days without checks stay empty. */
export function dayBars(days: string[], counts: DayCount[]): DayBar[] {
  const byDay = new Map<string, { checks: number; passed: number }>();
  for (const c of counts) {
    const d = byDay.get(c.day) ?? { checks: 0, passed: 0 };
    d.checks += c.checks;
    d.passed += c.passed;
    byDay.set(c.day, d);
  }
  return days.map((day) => {
    const d = byDay.get(day) ?? { checks: 0, passed: 0 };
    return { day, ...d, uptime: d.checks > 0 ? (d.passed / d.checks) * 100 : null };
  });
}

/** Colors: all up, a blip (≥ 99%), degraded (≥ 95%), or down for a real part of the day. */
export function dayTone(uptime: number | null): DayTone {
  if (uptime === null) return "none";
  if (uptime >= 100) return "up";
  if (uptime >= 99) return "blip";
  if (uptime >= 95) return "degraded";
  return "down";
}

/** Uptime over all the bars' checks. */
export function overallUptime(bars: DayBar[]): number | null {
  const checks = bars.reduce((n, b) => n + b.checks, 0);
  return checks > 0 ? (bars.reduce((n, b) => n + b.passed, 0) / checks) * 100 : null;
}

/** Per-day counts from individual checks (sample data, where there's no database to count them). */
export function countByDay(checks: { checked_at: string; passed: boolean }[], timeZone: string): DayCount[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const byDay = new Map<string, DayCount>();
  for (const c of checks) {
    const day = fmt.format(new Date(c.checked_at));
    const d = byDay.get(day) ?? { day, checks: 0, passed: 0 };
    d.checks++;
    if (c.passed) d.passed++;
    byDay.set(day, d);
  }
  return [...byDay.values()];
}
