"use client";

import { useActionState, useState } from "react";
import { importFromWpeAction, type FormState } from "@/app/manage-actions";
import { FormActions, FormError, fieldError, inputClass } from "@/components/form";
import { table } from "@/components/ui";
import { INTERVALS, SEVERITIES, SEVERITY_LABELS, formatInterval } from "@/lib/labels";
import {
  IMPORT_EXTRA_INTERVAL,
  MAX_IMPORT,
  checksPerDay,
  isSuggested,
  type ImportCandidate,
} from "@/lib/monitoring/wpengine-import";

const initial: FormState = { ok: true };
// The shared input style is full width; these sit inline, sized by their content or own width.
const inlineInput = inputClass.replace("w-full ", "");
const number = (n: number) => n.toLocaleString("en-US");

function Tag({ children, tone = "slate" }: { children: string; tone?: "slate" | "amber" | "teal" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-800",
    teal: "bg-fig-teal/10 text-fig-teal",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function WpeImportForm({
  candidates,
  currentPerDay,
  capacityPerDay,
  disabledReason,
}: {
  candidates: ImportCandidate[];
  /** Scheduled checks a day from monitors that already exist. */
  currentPerDay: number;
  /** Scheduler capacity when it runs every 5 minutes and every minute. */
  capacityPerDay: { fiveMinutes: number; everyMinute: number };
  disabledReason?: string;
}) {
  const [state, action] = useActionState(importFromWpeAction, initial);
  const [selected, setSelected] = useState(() => new Set(candidates.filter(isSuggested).map((c) => c.installId)));
  const [query, setQuery] = useState("");
  const [showMonitored, setShowMonitored] = useState(false);
  const [uptime, setUptime] = useState(true);
  const [ssl, setSsl] = useState(true);
  const [wordpress, setWordpress] = useState(true);
  const [interval, setUptimeInterval] = useState(15);

  const q = query.trim().toLowerCase();
  const visible = (c: ImportCandidate) =>
    (showMonitored || !c.monitoredBy) && (!q || c.siteName.toLowerCase().includes(q) || c.domain.includes(q));
  const shown = candidates.filter(visible);
  const monitoredCount = candidates.filter((c) => c.monitoredBy).length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setShown = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of shown) {
        if (c.monitoredBy) continue;
        if (on) next.add(c.installId);
        else next.delete(c.installId);
      }
      return next;
    });

  const perSite = checksPerDay([
    ...(uptime ? [interval] : []),
    ...(ssl ? [IMPORT_EXTRA_INTERVAL] : []),
    ...(wordpress ? [IMPORT_EXTRA_INTERVAL] : []),
  ]);
  const added = perSite * selected.size;
  const total = currentPerDay + added;
  const overFive = total > capacityPerDay.fiveMinutes;
  const overMinute = total > capacityPerDay.everyMinute;

  return (
    <form action={action} className="space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold text-fig-ink">Checks to add to each site</h2>
          {fieldError(state, "checks") && <p className="mt-1 text-xs text-red-700">{fieldError(state, "checks")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-fig-ink">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="uptime"
              checked={uptime}
              onChange={(e) => setUptime(e.target.checked)}
              className="size-4 accent-fig-plum"
            />
            Homepage uptime, every
          </label>
          <select
            name="interval_minutes"
            value={interval}
            onChange={(e) => setUptimeInterval(Number(e.target.value))}
            disabled={!uptime}
            className={`${inlineInput} -ml-4`}
          >
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {formatInterval(m)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="ssl"
              checked={ssl}
              onChange={(e) => setSsl(e.target.checked)}
              className="size-4 accent-fig-plum"
            />
            SSL certificate
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="wordpress"
              checked={wordpress}
              onChange={(e) => setWordpress(e.target.checked)}
              className="size-4 accent-fig-plum"
            />
            WordPress health &amp; backups
          </label>
          <label className="flex items-center gap-2">
            Severity
            <select name="severity_on_failure" defaultValue="critical" className={inlineInput}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          SSL and WordPress checks run every 6 hours. Broken link scans and tracking tags can be added per client
          later. First checks are spread over each interval, so imported sites don&apos;t all run at once.
        </p>
        <div
          className={`rounded-md px-3 py-2 text-sm ${overFive ? "bg-amber-50 text-amber-900" : "bg-fig-plum-mist text-fig-ink"}`}
        >
          <strong>{number(selected.size)}</strong> site{selected.size === 1 ? "" : "s"} selected: about{" "}
          <strong>{number(added)}</strong> scheduled checks a day, on top of {number(currentPerDay)} today (
          {number(total)} total).
          {overMinute ? (
            <span className="block text-xs">
              That&apos;s more than the scheduler can run even every minute ({number(capacityPerDay.everyMinute)} a
              day). Choose a longer uptime interval or fewer sites.
            </span>
          ) : overFive ? (
            <span className="block text-xs">
              More than the scheduler runs every 5 minutes ({number(capacityPerDay.fiveMinutes)} a day). Switch it to
              every minute first (README → Scheduled checks → Checking many sites), or checks will fall behind.
            </span>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search site or domain"
            aria-label="Search site or domain"
            className={`${inlineInput} w-64`}
          />
          <label className="flex items-center gap-2 text-sm text-fig-ink">
            <input
              type="checkbox"
              checked={showMonitored}
              onChange={(e) => setShowMonitored(e.target.checked)}
              className="size-4 accent-fig-plum"
            />
            Show already monitored ({monitoredCount})
          </label>
          <span className="ml-auto flex gap-3 text-sm">
            <button type="button" onClick={() => setShown(true)} className="text-fig-plum hover:underline">
              Select all shown
            </button>
            <button type="button" onClick={() => setShown(false)} className="text-fig-plum hover:underline">
              Clear shown
            </button>
          </span>
        </header>
        {fieldError(state, "install") && (
          <p className="border-b border-slate-100 px-4 py-2 text-sm text-red-700">{fieldError(state, "install")}</p>
        )}
        <div className={table.wrapper}>
          <table className={table.table}>
            <thead className={table.head}>
              <tr>
                <th className={`${table.th} w-10`}>
                  <span className="sr-only">Import</span>
                </th>
                <th className={table.th}>Client name</th>
                <th className={table.th}>Website</th>
                <th className={table.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                // Filtered rows stay in the form (hidden), so ticked sites are still imported.
                <tr key={c.installId} hidden={!visible(c)} className={table.row}>
                  <td className={table.td}>
                    <input
                      type="checkbox"
                      name="install"
                      value={c.installId}
                      checked={selected.has(c.installId)}
                      disabled={Boolean(c.monitoredBy)}
                      onChange={(e) => toggle(c.installId, e.target.checked)}
                      aria-label={`Import ${c.siteName}`}
                      className="size-4 accent-fig-plum"
                    />
                  </td>
                  <td className={`${table.td} min-w-56`}>
                    <input
                      name={`name_${c.installId}`}
                      defaultValue={c.existingClient ?? c.siteName}
                      disabled={Boolean(c.monitoredBy)}
                      aria-label={`Client name for ${c.domain}`}
                      className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                    />
                  </td>
                  <td className={table.td}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-fig-ink hover:text-fig-plum hover:underline"
                    >
                      {c.domain}
                    </a>
                    <span className="block text-xs text-slate-500">WP Engine install: {c.installName}</span>
                  </td>
                  <td className={table.td}>
                    <span className="flex flex-wrap gap-1">
                      {c.monitoredBy && <Tag tone="teal">{`Monitored · ${c.monitoredBy}`}</Tag>}
                      {!c.monitoredBy && c.existingClient && <Tag tone="teal">Adds to existing client</Tag>}
                      {c.wpeDomainOnly && <Tag tone="amber">wpengine.com address only</Tag>}
                      {c.sandbox && <Tag>Sandbox</Tag>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No sites match this search.</p>
          )}
        </div>
      </section>

      <FormError state={state} fields={["install", "checks"]} />
      {disabledReason ? (
        <p className="text-sm text-slate-500">{disabledReason}</p>
      ) : selected.size > MAX_IMPORT ? (
        <p className="text-sm text-red-700">Import at most {MAX_IMPORT} sites at a time.</p>
      ) : (
        <FormActions label={`Import ${number(selected.size)} site${selected.size === 1 ? "" : "s"}`} cancelHref="/clients" />
      )}
    </form>
  );
}
