import type { ScorePoint } from "@/lib/data";
import { formatDate, formatSeconds } from "@/lib/format";

const W = 640;
const H = 170;
const PAD = { top: 10, right: 12, bottom: 22, left: 30 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

/** Page speed scores over time (0–100), with Google's good/okay/poor bands and the minimum from Settings. */
export function ScoreTrend({ points, minScore }: { points: ScorePoint[]; minScore: number }) {
  if (points.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-500">No scores yet: the chart fills in as daily tests run.</p>;
  }
  const t0 = Date.parse(points[0].checkedAt);
  const t1 = Date.parse(points.at(-1)!.checkedAt);
  const span = Math.max(t1 - t0, 1);
  const x = (iso: string) => PAD.left + (points.length === 1 ? plotW / 2 : ((Date.parse(iso) - t0) / span) * plotW);
  const y = (score: number) => PAD.top + (1 - score / 100) * plotH;
  const band = (from: number, to: number, fill: string) => (
    <rect x={PAD.left} y={y(to)} width={plotW} height={y(from) - y(to)} fill={fill} />
  );
  const latest = points.at(-1)!;
  const scores = points.map((p) => p.score);

  return (
    <div className="px-4 py-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Performance scores from ${formatDate(points[0].checkedAt)} to ${formatDate(latest.checkedAt)}`}>
        {band(0, 50, "var(--color-fig-coral-wash)")}
        {band(50, 90, "var(--color-fig-cream)")}
        {band(90, 100, "var(--color-fig-teal-wash)")}
        {[0, 50, 90, 100].map((s) => (
          <text key={s} x={PAD.left - 6} y={y(s) + 3} textAnchor="end" className="fill-slate-400" fontSize="9">
            {s}
          </text>
        ))}
        {minScore > 0 && (
          <g>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(minScore)} y2={y(minScore)} stroke="var(--color-fig-coral)" strokeDasharray="4 3" strokeWidth="1" />
            <text x={PAD.left + plotW} y={y(minScore) - 3} textAnchor="end" fontSize="9" fill="var(--color-fig-coral)">
              minimum {minScore}
            </text>
          </g>
        )}
        <polyline
          points={points.map((p) => `${x(p.checkedAt).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--color-fig-plum)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {points.map((p) => (
          <circle key={p.checkedAt} cx={x(p.checkedAt)} cy={y(p.score)} r="2.5" fill="var(--color-fig-plum)">
            <title>{`${formatDate(p.checkedAt)}: ${p.score}/100${p.lcpMs !== null ? `, LCP ${formatSeconds(p.lcpMs)}` : ""}`}</title>
          </circle>
        ))}
        <text x={PAD.left} y={H - 6} fontSize="9" className="fill-slate-500">
          {formatDate(points[0].checkedAt)}
        </text>
        <text x={PAD.left + plotW} y={H - 6} fontSize="9" textAnchor="end" className="fill-slate-500">
          {formatDate(latest.checkedAt)}
        </text>
      </svg>
      <p className="mt-1 text-xs text-slate-500">
        {points.length} test{points.length === 1 ? "" : "s"} · lowest {Math.min(...scores)}, highest {Math.max(...scores)} · latest{" "}
        {latest.score}. Hover a point for its date.
      </p>
    </div>
  );
}
