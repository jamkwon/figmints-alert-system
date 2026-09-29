import { formatDate } from "@/lib/format";
import { dayTone, overallUptime, type DayBar, type DayTone } from "@/lib/uptime-history";

const TONE: Record<DayTone, { bar: string; label: string }> = {
  none: { bar: "bg-slate-200", label: "No checks" },
  up: { bar: "bg-fig-teal-light", label: "Up all day" },
  blip: { bar: "bg-amber-300", label: "Brief problems" },
  degraded: { bar: "bg-amber-500", label: "Degraded" },
  down: { bar: "bg-fig-coral", label: "Down for part of the day" },
};

function uptimeText(value: number | null): string {
  if (value === null) return "no data";
  return value === 100 ? "100%" : `${value.toFixed(value >= 99.9 ? 3 : 2)}%`;
}

/** One bar per day, colored by that day's uptime; hover for the day's numbers. */
export function UptimeBars({
  bars,
  startLabel,
  endLabel = "Today",
  compact = false,
}: {
  bars: DayBar[];
  startLabel?: string;
  endLabel?: string;
  /** Smaller, without the legend (tables, the report). */
  compact?: boolean;
}) {
  const overall = overallUptime(bars);
  return (
    <div>
      <div className={`flex items-stretch gap-[2px] ${compact ? "h-5" : "h-8"}`} role="img" aria-label={`Uptime ${uptimeText(overall)} over ${bars.length} days`}>
        {bars.map((b) => {
          const tone = TONE[dayTone(b.uptime)];
          return (
            <div
              key={b.day}
              className={`min-w-[2px] flex-1 rounded-[2px] ${tone.bar}`}
              title={`${formatDate(`${b.day}T12:00:00Z`)}: ${b.uptime === null ? "no checks" : `${uptimeText(b.uptime)} (${b.passed} of ${b.checks} checks passed)`}`}
            />
          );
        })}
      </div>
      {!compact && (
        <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
          <span>{startLabel ?? `${bars.length} days ago`}</span>
          <span className="font-medium text-fig-ink">{uptimeText(overall)} uptime</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Color key for the bars. */
export function UptimeLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {(["up", "blip", "degraded", "down", "none"] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-[2px] ${TONE[t].bar}`} />
          {TONE[t].label}
        </span>
      ))}
    </div>
  );
}
