import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/print-button";
import { SeverityBadge } from "@/components/status";
import { table } from "@/components/ui";
import { getReportInput } from "@/lib/data";
import { APP_TIMEZONE, displayUrl, formatDate, formatDateTime, formatSeconds } from "@/lib/format";
import { buildMonthlyReport, monthRange, recentMonths } from "@/lib/report";

export const metadata: Metadata = { title: "Monthly report" };

// Tones for good / okay / needs attention, from the Figmints palette.
type Tone = "good" | "fair" | "poor" | "neutral";
const TONE: Record<Tone, { text: string; bg: string; dot: string; ring: string }> = {
  good: { text: "text-fig-teal", bg: "bg-fig-teal-wash", dot: "bg-fig-teal-light", ring: "var(--color-fig-teal-light)" },
  fair: { text: "text-amber-700", bg: "bg-fig-cream", dot: "bg-amber-400", ring: "#f59e0b" },
  poor: { text: "text-red-700", bg: "bg-fig-coral-wash", dot: "bg-fig-coral", ring: "var(--color-fig-coral)" },
  neutral: { text: "text-slate-600", bg: "bg-slate-100", dot: "bg-slate-300", ring: "#cbd5e1" },
};

function uptimeTone(value: number | null): Tone {
  if (value === null) return "neutral";
  return value >= 99.9 ? "good" : value >= 99 ? "fair" : "poor";
}

function scoreTone(score: number | null): Tone {
  if (score === null) return "neutral";
  return score >= 90 ? "good" : score >= 50 ? "fair" : "poor";
}

/** Days until a date: far off is good, within 60 days fair, within 30 poor. */
function renewalTone(iso: string): Tone {
  const days = (Date.parse(iso) - Date.now()) / 86_400_000;
  return days > 60 ? "good" : days > 30 ? "fair" : "poor";
}

function uptimeText(value: number | null): string {
  if (value === null) return "–";
  return value === 100 ? "100%" : `${value.toFixed(value >= 99.9 ? 3 : 2)}%`;
}

function duration(minutes: number | null): string {
  if (minutes === null) return "Still open";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.round(minutes / 60 / 24)} days`;
}

function Tile({ label, value, note, accent, valueClass }: { label: string; value: ReactNode; note?: ReactNode; accent: string; valueClass?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white`}>
      <div className={`h-1.5 ${accent}`} />
      <div className="p-4">
        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
        <div className={`mt-1 font-display text-3xl font-bold ${valueClass ?? "text-fig-plum-dark"}`}>{value}</div>
        {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
      </div>
    </div>
  );
}

/** A report section: title with a colored accent bar. */
function Section({ title, accent, aside, children }: { title: string; accent: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-slate-100 bg-fig-plum-mist px-4 py-3">
        <h2 className="flex items-center gap-2.5 font-display text-base font-bold text-fig-plum-dark">
          <span className={`h-5 w-1.5 rounded-full ${accent}`} />
          {title}
        </h2>
        {aside && <div className="text-xs text-slate-500">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ${TONE[tone].bg} ${TONE[tone].text}`}>
      <span className={`size-2 rounded-full ${TONE[tone].dot}`} />
      {children}
    </span>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const tone = TONE[scoreTone(score)];
  const deg = Math.round(((score ?? 0) / 100) * 360);
  return (
    <div
      className="grid size-16 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(${tone.ring} ${deg}deg, #e2e8f0 0)` }}
    >
      <div className={`grid size-12 place-items-center rounded-full bg-white font-display text-lg font-bold ${tone.text}`}>
        {score ?? "–"}
      </div>
    </div>
  );
}

/** The month's lowest–highest score on a 0–100 track, with the average marked. */
function RangeBar({ min, max, average }: { min: number; max: number; average: number }) {
  return (
    <div className="relative h-2.5 w-full rounded-full bg-gradient-to-r from-fig-coral-wash via-fig-cream to-fig-teal-wash">
      <div
        className="absolute top-0 h-2.5 rounded-full bg-fig-plum/70"
        style={{ left: `${min}%`, width: `${Math.max(max - min, 1.5)}%` }}
      />
      <div className="absolute -top-1 h-4.5 w-0.5 bg-fig-plum-dark" style={{ left: `${average}%` }} />
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-sm text-slate-500">{children}</p>;
}

export default async function MonthlyReportPage({ params, searchParams }: PageProps<"/clients/[id]/report">) {
  const { id } = await params;
  const sp = await searchParams;
  const months = recentMonths(new Date(), APP_TIMEZONE);
  // Default to last month: the one to send at the start of a month.
  const requested = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : months[1];
  const month = monthRange(requested, APP_TIMEZONE);
  if (!month) notFound();
  const data = await getReportInput(id, month);
  if (!data) notFound();
  const { client } = data;
  const r = buildMonthlyReport(data.input);
  const wpWork = r.wordpress.reduce((n, w) => n + w.pluginUpdates.length + w.themeUpdates.length + (w.core ? 1 : 0), 0);
  const overallTone = uptimeTone(r.overview.uptime);

  return (
    <div className="space-y-6">
      {/* Controls: not printed. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/clients/${client.id}`} className="text-sm text-slate-600 hover:text-fig-plum">
          ← {client.name}
        </Link>
        <div className="flex items-center gap-3">
          <form className="flex items-center gap-2 text-sm">
            <label htmlFor="month" className="text-slate-600">
              Month
            </label>
            <select
              id="month"
              name="month"
              defaultValue={month.key}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {months.map((key, i) => (
                <option key={key} value={key}>
                  {monthRange(key, APP_TIMEZONE)!.label}
                  {i === 0 ? " (so far)" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:border-fig-plum hover:text-fig-plum">
              Show
            </button>
          </form>
          <PrintButton />
        </div>
      </div>

      {/* Brand header */}
      <header className="relative overflow-hidden rounded-xl bg-fig-brand px-8 py-7 text-white">
        <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-fig-pink/25" />
        <div className="pointer-events-none absolute -bottom-20 right-40 size-40 rounded-full bg-fig-magenta/40" />
        <div className="relative flex items-start justify-between gap-6">
          <div>
            <Image src="/figmints-logo-white.svg" alt="Figmints" width={150} height={46} priority />
            <div className="mt-6 text-xs font-medium tracking-[0.2em] text-fig-pink-light uppercase">Monthly website report</div>
            <h1 className="mt-1 font-display text-3xl font-bold">{client.name}</h1>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-bold">{month.label}</div>
            {r.inProgress && <div className="mt-1 text-sm text-fig-pink-light">Month in progress · figures so far</div>}
            <div className="mt-1 text-xs text-white/60">Generated {formatDate(new Date().toISOString())}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 print:grid-cols-4">
        <Tile
          label="Uptime"
          value={uptimeText(r.overview.uptime)}
          valueClass={TONE[overallTone].text}
          accent={overallTone === "good" ? "bg-fig-teal-light" : overallTone === "fair" ? "bg-amber-400" : overallTone === "poor" ? "bg-fig-coral" : "bg-slate-300"}
          note={`${r.overview.checks.toLocaleString("en-US")} page-load checks`}
        />
        <Tile label="Incidents" value={r.overview.incidents} accent="bg-fig-plum" note="opened this month" />
        <Tile
          label="Time to resolve"
          value={r.overview.meanMinutesToResolve === null ? "–" : duration(r.overview.meanMinutesToResolve)}
          accent="bg-fig-magenta"
          note="average"
        />
        <Tile label="WordPress updates" value={wpWork} accent="bg-fig-pink" valueClass="text-fig-magenta" note="core, plugins and themes" />
      </div>

      <Section title="Uptime by website" accent="bg-fig-teal-light">
        {r.websites.length === 0 ? (
          <Empty>No websites.</Empty>
        ) : (
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>Website</th>
                <th className={table.th}>Uptime</th>
                <th className={table.th}>Checks</th>
              </tr>
            </thead>
            <tbody>
              {r.websites.map((w) => (
                <tr key={w.url} className="border-b border-slate-100 last:border-0">
                  <td className={table.td}>
                    <span className="font-medium text-fig-ink">{w.name}</span>{" "}
                    <span className="text-slate-500">· {displayUrl(w.url)}</span>
                    {w.environment !== "production" && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{w.environment}</span>
                    )}
                  </td>
                  <td className={table.td}>
                    <Pill tone={uptimeTone(w.uptime)}>{uptimeText(w.uptime)}</Pill>
                  </td>
                  <td className={`${table.td} text-slate-600`}>{w.checks.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Incidents" accent="bg-fig-plum" aside={r.incidents.length ? `${r.incidents.length} this month` : undefined}>
        {r.incidents.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-fig-teal">
            <span className="size-2 rounded-full bg-fig-teal-light" /> No incidents this month.
          </div>
        ) : (
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={table.th}>What happened</th>
                <th className={table.th}>Severity</th>
                <th className={table.th}>Detected</th>
                <th className={table.th}>Resolved in</th>
              </tr>
            </thead>
            <tbody>
              {r.incidents.map((i) => (
                <tr key={`${i.openedAt}-${i.title}`} className="border-b border-slate-100 last:border-0">
                  <td className={table.td}>{i.title}</td>
                  <td className={table.td}>
                    <SeverityBadge severity={i.severity} />
                  </td>
                  <td className={`${table.td} text-slate-600`}>{formatDateTime(i.openedAt)}</td>
                  <td className={`${table.td} font-medium ${i.minutes === null ? "text-amber-700" : "text-fig-teal"}`}>
                    {duration(i.minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {r.wordpress.length > 0 && (
        <Section title="WordPress maintenance" accent="bg-fig-pink">
          {r.wordpress.map((w) => (
            <div key={w.website} className="border-b border-slate-100 px-4 py-4 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display font-bold text-fig-ink">{w.website}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-fig-teal-wash px-2.5 py-1 font-medium text-fig-teal">
                    {w.pluginUpdates.length + w.themeUpdates.length + (w.core ? 1 : 0)} updated
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${w.pendingUpdates === 0 ? "bg-fig-teal-wash text-fig-teal" : "bg-fig-cream text-amber-700"}`}
                  >
                    {w.pendingUpdates === 0 ? "Up to date" : `${w.pendingUpdates} pending`}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${w.backupProblems === 0 ? "bg-fig-teal-wash text-fig-teal" : "bg-fig-coral-wash text-red-700"}`}
                  >
                    {w.backupProblems === 0 ? "Backups on schedule" : `${w.backupProblems} backup problem(s)`}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium ${w.phpErrors.length === 0 ? "bg-fig-teal-wash text-fig-teal" : "bg-fig-coral-wash text-red-700"}`}
                  >
                    {w.phpErrors.length === 0 ? "No PHP errors" : `PHP errors: ${w.phpErrors.map((e) => `${e.source} (~${e.count})`).join(", ")}`}
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div>
                  <span className="text-slate-500">WordPress core: </span>
                  {w.core ? (
                    <span className="rounded bg-fig-plum-mist px-1.5 py-0.5 font-medium text-fig-plum">
                      {w.core.from} → {w.core.to}
                    </span>
                  ) : (
                    <span className="text-slate-500">no update this month</span>
                  )}
                </div>
                {w.pluginUpdates.length + w.themeUpdates.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[...w.pluginUpdates, ...w.themeUpdates].map((p) => (
                      <span key={p.name} className="rounded-md border border-fig-pink-light bg-fig-plum-mist px-2 py-0.5 text-xs text-fig-ink">
                        <span className="font-medium">{p.name}</span>{" "}
                        <span className="text-fig-magenta">
                          {p.from} → {p.to}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500">No plugin or theme updates this month.</div>
                )}
                {w.lastBackupAt && <div className="text-xs text-slate-500">Last backup {formatDate(w.lastBackupAt)}</div>}
              </div>
              {!w.fullDetail && (
                <p className="mt-2 text-xs text-slate-500">
                  Plugin updates are based on what&apos;s visible from outside; install the Website Watch plugin for the full
                  list.
                </p>
              )}
            </div>
          ))}
        </Section>
      )}

      {r.pageSpeed.length > 0 && (
        <Section title="Page speed" accent="bg-fig-magenta" aside="Google PageSpeed, mobile">
          {r.pageSpeed.map((p) => (
            <div key={p.url + p.website} className="flex items-center gap-5 border-b border-slate-100 px-4 py-4 last:border-0">
              <ScoreRing score={p.latest} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-fig-ink">{displayUrl(p.url)}</span>
                  <span className="text-xs text-slate-500">
                    Largest paint {formatSeconds(p.latestLcpMs)} · {p.tests} test{p.tests === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3">
                  <RangeBar min={p.min} max={p.max} average={p.average} />
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>
                      Month range {p.min}–{p.max} · average {p.average}
                    </span>
                    <span>0 – 100</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </Section>
      )}

      {(r.ssl.length > 0 || r.domains.length > 0 || r.visibility.length > 0) && (
        <Section title="Security and visibility" accent="bg-fig-teal">
          <dl className="divide-y divide-slate-100 text-sm">
            {r.ssl.map((s) => (
              <div key={`ssl-${s.website}`} className="grid grid-cols-[16rem_1fr] items-center gap-4 px-4 py-3">
                <dt className="text-slate-600">SSL certificate · {s.website}</dt>
                <dd>
                  <Pill tone={renewalTone(s.validTo)}>Valid until {formatDate(s.validTo)}</Pill>
                </dd>
              </div>
            ))}
            {r.domains.map((d) => (
              <div key={`dom-${d.domain}`} className="grid grid-cols-[16rem_1fr] items-center gap-4 px-4 py-3">
                <dt className="text-slate-600">Domain · {d.domain}</dt>
                <dd>
                  <Pill tone={renewalTone(d.expiresAt)}>Registered until {formatDate(d.expiresAt)}</Pill>
                  {d.registrar && <span className="ml-2 text-xs text-slate-500">{d.registrar}</span>}
                </dd>
              </div>
            ))}
            {r.visibility.map((v) => (
              <div key={`vis-${v.website}`} className="grid grid-cols-[16rem_1fr] items-center gap-4 px-4 py-3">
                <dt className="text-slate-600">Search engines · {v.website}</dt>
                <dd>
                  {v.problems === 0 ? (
                    <Pill tone="good">Open to search engines all month</Pill>
                  ) : (
                    <>
                      <Pill tone="poor">
                        {v.problems} of {v.checks} checks found a problem
                      </Pill>
                      {v.latestProblem && <span className="mt-1 block text-xs text-slate-500">{v.latestProblem}</span>}
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <footer className="flex items-center justify-between gap-4 border-t-4 border-fig-plum pt-3 text-xs text-slate-500">
        <span>
          Uptime counts page-load checks every few minutes. Times are in {APP_TIMEZONE}.
        </span>
        <span className="font-medium text-fig-plum">Prepared by Figmints · figmints.com</span>
      </footer>
    </div>
  );
}
