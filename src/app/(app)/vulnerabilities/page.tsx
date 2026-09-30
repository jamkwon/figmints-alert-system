import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HealthBadge } from "@/components/status";
import { EmptyState, PageHeader, Panel, table } from "@/components/ui";
import { getAppData, type MonitorView } from "@/lib/data";
import { displayUrl, timeAgo, vulnerabilityInfo, type VulnerabilityInfo } from "@/lib/format";
import { compareVersions } from "@/lib/monitoring/wordpress";

export const metadata: Metadata = { title: "Vulnerabilities" };

type Software = VulnerabilityInfo["software"][number];
type Finding = VulnerabilityInfo["findings"][number];

interface AffectedSite {
  view: MonitorView;
  software: Software;
}

/** One plugin, theme or WordPress core across every site that runs a vulnerable version. */
interface Group {
  key: string;
  type: Software["type"];
  name: string;
  sites: AffectedSite[];
  findings: Map<string, Finding>;
  urgent: boolean;
  worstScore: number | null;
  /** Version that fixes it on every site; null when any site has no fix yet. */
  updateTo: string | null;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fig-ink">{children}</div>
    </div>
  );
}

function groupByPackage(checked: { view: MonitorView; info: VulnerabilityInfo }[]): Group[] {
  const groups = new Map<string, Group>();
  for (const { view, info } of checked) {
    for (const s of info.software) {
      const key = `${s.type}:${s.slug}`;
      const g: Group = groups.get(key) ?? {
        key,
        type: s.type,
        name: s.type === "core" ? "WordPress" : s.name,
        sites: [],
        findings: new Map(),
        urgent: false,
        worstScore: null,
        updateTo: null,
      };
      g.sites.push({ view, software: s });
      for (const f of info.findings.filter((f) => f.type === s.type && f.slug === s.slug)) g.findings.set(f.id, f);
      g.urgent ||= s.urgent;
      if (s.worstScore !== null && (g.worstScore === null || s.worstScore > g.worstScore)) g.worstScore = s.worstScore;
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    const fixes = g.sites.map((s) => s.software.updateTo);
    g.updateTo = fixes.includes(null) ? null : (fixes as string[]).sort(compareVersions).at(-1)!;
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.urgent) - Number(a.urgent) || b.sites.length - a.sites.length || (b.worstScore ?? 0) - (a.worstScore ?? 0),
  );
}

export default async function VulnerabilitiesPage() {
  const { monitors } = await getAppData();
  const vulnMonitors = monitors.filter((m) => m.monitor.monitor_type === "vulnerabilities" && m.health !== "inactive");
  const checked = vulnMonitors.flatMap((view) => {
    const info = vulnerabilityInfo(view.summary?.last_metadata);
    return info ? [{ view, info }] : [];
  });
  const notChecked = vulnMonitors.filter((view) => !checked.some((c) => c.view === view));
  const partial = checked.filter((c) => c.info.coverage === "partial");
  const groups = groupByPackage(checked);
  const affectedSites = new Set(groups.flatMap((g) => g.sites.map((s) => s.view.website.id))).size;
  const seriousSites = new Set(groups.filter((g) => g.urgent).flatMap((g) => g.sites.filter((s) => s.software.urgent).map((s) => s.view.website.id))).size;
  const feedAt = checked.map((c) => c.info.feedRefreshedAt).filter((d): d is string => d !== null).sort().at(-1);

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/settings" className="text-slate-500 hover:text-fig-plum">
          ← Settings
        </Link>
      </div>
      <PageHeader
        title="Vulnerabilities"
        description={
          <>
            Known vulnerabilities in the WordPress, plugin and theme versions your sites run, grouped so one update can be
            planned across every site that needs it.{feedAt && <> List from Wordfence, downloaded {timeAgo(feedAt)}.</>}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Sites checked">{checked.length}</Stat>
        <Stat label="Sites affected">{affectedSites}</Stat>
        <Stat label="Serious (no login needed)">{seriousSites > 0 ? <span className="text-red-700">{seriousSites}</span> : 0}</Stat>
        <Stat label="Plugins, themes and core">{groups.length}</Stat>
      </div>

      <Panel title="What to update" aside="Serious first, then by number of sites">
        {groups.length === 0 ? (
          <EmptyState>
            {checked.length > 0 ? "No known vulnerabilities on any checked site." : "No sites have been checked yet."}
          </EmptyState>
        ) : (
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Software</th>
                  <th className={table.th}>Sites</th>
                  <th className={table.th}>Vulnerabilities</th>
                  <th className={table.th}>Fix</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} className={table.row}>
                    <td className={table.td}>
                      <div className="font-medium text-fig-ink">{g.name}</div>
                      <div className="text-xs text-slate-500">{g.type === "core" ? "WordPress core" : g.type === "theme" ? "Theme" : "Plugin"}</div>
                      <div className="mt-1.5">
                        <HealthBadge health={g.urgent ? "critical" : "warning"} label={g.urgent ? "Serious" : "Known issue"} />
                      </div>
                    </td>
                    <td className={table.td}>
                      <ul className="space-y-1">
                        {g.sites.map(({ view, software }) => (
                          <li key={view.monitor.id}>
                            <Link href={`/monitors/${view.monitor.id}`} className="text-fig-plum hover:underline">
                              {view.client.name}
                            </Link>
                            <span className="text-xs text-slate-500">
                              {" "}
                              · {displayUrl(view.website.url)} · {software.version}
                              {software.active === false && " (inactive)"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={`${table.td} max-w-md`}>
                      <ul className="space-y-1">
                        {[...g.findings.values()]
                          .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.cvss ?? 0) - (a.cvss ?? 0))
                          .map((f) => (
                            <li key={f.id} className="text-xs text-slate-600">
                              <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-fig-plum hover:underline">
                                {f.title}
                              </a>
                              <span className="text-slate-500">
                                {" "}
                                · {f.cvss !== null ? `CVSS ${f.cvss.toFixed(1)}` : "no score"}
                                {f.no_login ? " · no login needed" : " · needs a login"}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </td>
                    <td className={`${table.td} whitespace-nowrap`}>
                      {g.updateTo ? (
                        <>Update to {g.updateTo}</>
                      ) : (
                        <span className="text-red-700">No fix yet on some sites</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(partial.length > 0 || notChecked.length > 0) && (
        <Panel title="Not fully checked" className="mt-6">
          <ul className="divide-y divide-slate-100">
            {partial.map(({ view }) => (
              <li key={view.monitor.id} className="px-4 py-2.5 text-sm">
                <Link href={`/monitors/${view.monitor.id}`} className="text-fig-plum hover:underline">
                  {view.client.name}
                </Link>
                <span className="text-xs text-slate-500">
                  {" "}
                  · {displayUrl(view.website.url)} · only publicly visible plugins checked (Website Watch plugin not installed)
                </span>
              </li>
            ))}
            {notChecked.map((view) => (
              <li key={view.monitor.id} className="px-4 py-2.5 text-sm">
                <Link href={`/monitors/${view.monitor.id}`} className="text-fig-plum hover:underline">
                  {view.client.name}
                </Link>
                <span className="text-xs text-slate-500">
                  {" "}
                  · {displayUrl(view.website.url)} · {view.summary?.last_error_message ?? "not checked yet"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="mt-6 text-xs text-slate-500">
        Serious means the score set in Settings or more, and no login needed. Vulnerability data from{" "}
        <a href="https://www.wordfence.com/threat-intel/" target="_blank" rel="noopener noreferrer" className="hover:underline">
          Wordfence Intelligence
        </a>
        , Copyright 2012–{new Date().getFullYear()} Defiant Inc.
      </p>
    </>
  );
}
