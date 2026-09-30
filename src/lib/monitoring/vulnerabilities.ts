// Known vulnerabilities: reading the Wordfence Intelligence feed, matching a site's
// WordPress core, plugins and themes against it, and the pass/fail rules. Pure
// (relative imports only) so everything here can be tested directly.
import type { CheckOutcome } from "./evaluate.ts";
import { compareVersions } from "./wordpress.ts";

export const WORDFENCE_FEED_URL = "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production";

export type SoftwareType = "core" | "plugin" | "theme";

/** One affected version range of one vulnerability, as stored in wp_vulnerabilities. */
export interface VulnerabilityRange {
  vuln_id: string;
  software_type: SoftwareType;
  /** wordpress.org slug; "wordpress" for core. */
  slug: string;
  /** null: no lower bound ("*"). */
  from_version: string | null;
  from_inclusive: boolean;
  /** null: every version from from_version on. */
  to_version: string | null;
  to_inclusive: boolean;
  patched_versions: string[];
  title: string;
  cvss_score: number | null;
  cvss_vector: string | null;
  cvss_rating: string | null;
  /** The Wordfence record (attribution requires linking to it). */
  url: string;
  published_at: string | null;
}

// Feed ------------------------------------------------------------------------------

const SOFTWARE_TYPES: SoftwareType[] = ["core", "plugin", "theme"];
const text = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bound = (v: unknown): string | null => {
  const t = text(v, 40);
  return t === null || t === "*" ? null : t;
};

/** Wordfence's "2022-09-09 00:00:00" (UTC) as ISO; null when missing or unreadable. */
function feedDate(v: unknown): string | null {
  const t = text(v, 40);
  if (!t) return null;
  const d = new Date(`${t.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** One feed record as the ranges we store. Informational records and anything unreadable give none. */
export function rangesFromRecord(raw: unknown): VulnerabilityRange[] {
  const r = obj(raw);
  const id = text(r.id, 64);
  const title = text(r.title, 300);
  if (!id || !title || r.informational === true || !Array.isArray(r.software)) return [];
  const cvss = obj(r.cvss);
  const score = typeof cvss.score === "number" && Number.isFinite(cvss.score) ? Math.min(10, Math.max(0, cvss.score)) : null;
  const refs = Array.isArray(r.references) ? r.references : [];
  const url =
    refs.map((u) => text(u, 500)).find((u) => u?.startsWith("https://www.wordfence.com/")) ??
    `https://www.wordfence.com/threat-intel/vulnerabilities/id/${encodeURIComponent(id)}`;
  const shared = {
    vuln_id: id,
    title,
    cvss_score: score,
    cvss_vector: text(cvss.vector, 120),
    cvss_rating: text(cvss.rating, 20),
    url,
    published_at: feedDate(r.published),
  };
  return r.software.flatMap((rawSoftware) => {
    const s = obj(rawSoftware);
    const type = s.type as SoftwareType;
    const slug = text(s.slug, 200)?.toLowerCase();
    if (!SOFTWARE_TYPES.includes(type) || !slug) return [];
    const patched = Array.isArray(s.patched_versions)
      ? s.patched_versions.map((v) => text(v, 40)).filter((v): v is string => v !== null).slice(0, 20)
      : [];
    return Object.values(obj(s.affected_versions)).map((rawRange) => {
      const range = obj(rawRange);
      return {
        ...shared,
        software_type: type,
        slug,
        from_version: bound(range.from_version),
        from_inclusive: range.from_inclusive !== false,
        to_version: bound(range.to_version),
        to_inclusive: range.to_inclusive !== false,
        patched_versions: patched,
      };
    });
  });
}

/**
 * Splits the feed (one JSON object keyed by id, or an array) into its records as
 * it streams in, so the 100+ MB file never has to be held in memory at once.
 */
export class FeedSplitter {
  private buf = "";
  private pos = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  push(chunk: string): unknown[] {
    const records: unknown[] = [];
    this.buf += chunk;
    for (; this.pos < this.buf.length; this.pos++) {
      const c = this.buf[this.pos];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === "{" || c === "[") {
        this.depth++;
        if (this.depth === 2) this.start = this.pos;
      } else if (c === "}" || c === "]") {
        this.depth--;
        if (this.depth === 1 && this.start >= 0) {
          records.push(JSON.parse(this.buf.slice(this.start, this.pos + 1)));
          this.start = -1;
        }
      }
    }
    // Keep only the record still being read.
    const keep = this.start >= 0 ? this.start : this.buf.length;
    this.buf = this.buf.slice(keep);
    this.pos -= keep;
    if (this.start >= 0) this.start = 0;
    return records;
  }

  /** True once the whole top-level object or array has been read. */
  get done(): boolean {
    return this.depth === 0 && this.buf.trim() === "";
  }
}

// Matching --------------------------------------------------------------------------

/** What a site runs, from its latest WordPress Health check. */
export interface InstalledSoftware {
  type: SoftwareType;
  slug: string;
  name: string;
  /** null: installed, version unknown (can't be matched). */
  version: string | null;
  /** null: not known (public signals). */
  active: boolean | null;
}

export interface Inventory {
  software: InstalledSoftware[];
  /** True when the Website Watch Health plugin reported it: every plugin and theme, with versions. */
  complete: boolean;
}

/**
 * What a site runs, from a WordPress Health check's metadata: core, plugins and
 * (with the site plugin) themes. null when that check didn't get that far.
 */
export function inventoryFromWordPress(metadata: unknown): Inventory | null {
  const m = obj(metadata);
  const wp = obj(m.wordpress);
  if (!("wordpress" in m) || !Array.isArray(m.plugins)) return null;
  const report = m.plugin_report ? obj(m.plugin_report) : null;
  const software: InstalledSoftware[] = [];
  const core = text(wp.version, 40);
  if (core) software.push({ type: "core", slug: "wordpress", name: "WordPress", version: core, active: true });
  for (const raw of m.plugins) {
    const p = obj(raw);
    const slug = text(p.slug, 200);
    if (!slug) continue;
    software.push({
      type: "plugin",
      slug: slug.toLowerCase(),
      name: text(p.name, 200) ?? slug,
      version: text(p.version, 40),
      active: typeof p.active === "boolean" ? p.active : null,
    });
  }
  if (report && Array.isArray(report.themes)) {
    for (const raw of report.themes) {
      const t = obj(raw);
      const slug = text(t.slug, 200);
      if (!slug) continue;
      software.push({
        type: "theme",
        slug: slug.toLowerCase(),
        name: text(t.name, 200) ?? slug,
        version: text(t.version, 40),
        active: typeof t.active === "boolean" ? t.active : null,
      });
    }
  }
  return { software, complete: report !== null };
}

export function inAffectedRange(version: string, r: Pick<VulnerabilityRange, "from_version" | "from_inclusive" | "to_version" | "to_inclusive">): boolean {
  if (r.from_version !== null) {
    const c = compareVersions(version, r.from_version);
    if (c < 0 || (c === 0 && !r.from_inclusive)) return false;
  }
  if (r.to_version !== null) {
    const c = compareVersions(version, r.to_version);
    if (c > 0 || (c === 0 && !r.to_inclusive)) return false;
  }
  return true;
}

/** "PR:N" in the CVSS vector: an attacker doesn't need to log in. */
export function noLoginNeeded(vector: string | null): boolean {
  return vector !== null && /(^|\/)PR:N(\/|$)/.test(vector);
}

export interface Finding {
  vulnId: string;
  title: string;
  url: string;
  software: InstalledSoftware & { version: string };
  cvssScore: number | null;
  cvssRating: string | null;
  noLogin: boolean;
  /** Lowest patched version above the installed one; null when there's no fix yet. */
  fixedIn: string | null;
}

/** Every known vulnerability affecting the installed versions, worst first. */
export function matchVulnerabilities(installed: InstalledSoftware[], ranges: VulnerabilityRange[]): Finding[] {
  const byKey = new Map<string, VulnerabilityRange[]>();
  for (const r of ranges) {
    const key = `${r.software_type}:${r.slug}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const findings = new Map<string, Finding>();
  for (const s of installed) {
    if (!s.version) continue;
    const version = s.version;
    for (const r of byKey.get(`${s.type}:${s.slug.toLowerCase()}`) ?? []) {
      const id = `${r.vuln_id}:${s.type}:${s.slug}`;
      if (findings.has(id) || !inAffectedRange(version, r)) continue;
      const fixes = r.patched_versions.filter((p) => compareVersions(p, version) > 0).sort(compareVersions);
      findings.set(id, {
        vulnId: r.vuln_id,
        title: r.title,
        url: r.url,
        software: { ...s, version },
        cvssScore: r.cvss_score,
        cvssRating: r.cvss_rating,
        noLogin: noLoginNeeded(r.cvss_vector),
        fixedIn: fixes[0] ?? null,
      });
    }
  }
  return [...findings.values()].sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0));
}

/** Serious enough to fail the check (and alert, at Critical): a high score and no login needed. */
export function isUrgent(f: Pick<Finding, "cvssScore" | "noLogin">, minCvss: number): boolean {
  return f.noLogin && f.cvssScore !== null && f.cvssScore >= minCvss;
}

// Evaluation ------------------------------------------------------------------------

export interface SoftwareSummary {
  type: SoftwareType;
  slug: string;
  name: string;
  version: string;
  active: boolean | null;
  count: number;
  worstScore: number | null;
  urgent: boolean;
  /** Version that fixes every finding; null when at least one has no fix yet. */
  updateTo: string | null;
}

/** Findings grouped per plugin/theme/core, urgent and worst first. */
export function summarizeFindings(findings: Finding[], minCvss: number): SoftwareSummary[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.software.type}:${f.software.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()]
    .map((list) => {
      const s = list[0].software;
      const scores = list.map((f) => f.cvssScore).filter((n): n is number => n !== null);
      const noFix = list.some((f) => f.fixedIn === null);
      return {
        type: s.type,
        slug: s.slug,
        name: s.name,
        version: s.version,
        active: s.active,
        count: list.length,
        worstScore: scores.length ? Math.max(...scores) : null,
        urgent: list.some((f) => isUrgent(f, minCvss)),
        updateTo: noFix ? null : list.map((f) => f.fixedIn!).sort(compareVersions).at(-1)!,
      };
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.worstScore ?? 0) - (a.worstScore ?? 0));
}

function describe(s: SoftwareSummary): string {
  const name = s.type === "core" ? `WordPress ${s.version}` : `${s.name} ${s.version}`;
  const score = s.worstScore !== null ? `, CVSS ${s.worstScore.toFixed(1)}` : "";
  const fix = s.updateTo ? `update to ${s.updateTo}` : "no fix yet";
  const inactive = s.active === false ? ", inactive" : "";
  return `${name} (${s.count === 1 ? "1 vulnerability" : `${s.count} vulnerabilities`}${score}${inactive}; ${fix})`;
}

const MAX_MESSAGE = 500;
const MAX_STORED_FINDINGS = 100;

/** What a Vulnerabilities check works from, loaded by the server before it runs. */
export interface VulnerabilityContext {
  /** null: no WordPress Health result with a plugin list for this website. */
  inventory: Inventory | null;
  /** When that WordPress Health check ran. */
  inventoryCheckedAt: string | null;
  /** Ranges for the inventory's slugs, from the current feed generation. */
  ranges: VulnerabilityRange[];
  /** null: the feed has never been downloaded. */
  feedRefreshedAt: string | null;
}

/** The check's outcome and what the monitor page shows. */
export function vulnerabilityCheck(ctx: VulnerabilityContext, minCvss: number): { outcome: CheckOutcome; metadata: Record<string, unknown> } {
  const installed = ctx.inventory?.software ?? null;
  const findings = installed ? matchVulnerabilities(installed, ctx.ranges) : [];
  const outcome = evaluateVulnerabilities({ installed, feedLoaded: ctx.feedRefreshedAt !== null, findings, minCvss });
  const withVersion = installed?.filter((s) => s.version) ?? [];
  return {
    outcome,
    metadata: {
      vulnerabilities: {
        feed_refreshed_at: ctx.feedRefreshedAt,
        inventory_checked_at: ctx.inventoryCheckedAt,
        // "complete": the site plugin listed every plugin and theme; "partial": public signals only.
        coverage: ctx.inventory ? (ctx.inventory.complete ? "complete" : "partial") : null,
        checked: withVersion.length,
        unknown_versions: (installed?.length ?? 0) - withVersion.length,
        min_cvss: minCvss,
        software: summarizeFindings(findings, minCvss),
        findings: findings.slice(0, MAX_STORED_FINDINGS).map((f) => ({
          id: f.vulnId,
          title: f.title,
          url: f.url,
          type: f.software.type,
          slug: f.software.slug,
          name: f.software.name,
          version: f.software.version,
          active: f.software.active,
          cvss: f.cvssScore,
          rating: f.cvssRating,
          no_login: f.noLogin,
          urgent: isUrgent(f, minCvss),
          fixed_in: f.fixedIn,
        })),
        total_findings: findings.length,
      },
    },
  };
}

export interface VulnerabilityInput {
  /** null: no WordPress Health result to check against. */
  installed: InstalledSoftware[] | null;
  /** false: the feed hasn't been downloaded yet. */
  feedLoaded: boolean;
  findings: Finding[];
  minCvss: number;
}

/**
 * Failed when a vulnerability scores minCvss or more and needs no login; Warning
 * for any other known vulnerability, or when there's nothing to check against.
 */
export function evaluateVulnerabilities({ installed, feedLoaded, findings, minCvss }: VulnerabilityInput): CheckOutcome {
  const base = { http_status: null, response_time_ms: 0 };
  if (!feedLoaded) {
    return { ...base, status: "warning", passed: false, error_message: "The vulnerability list hasn't been downloaded yet" };
  }
  if (installed === null) {
    return {
      ...base,
      status: "warning",
      passed: false,
      error_message: "No recent WordPress Health result for this website to check (add a WordPress Health monitor)",
    };
  }
  if (findings.length === 0) return { ...base, status: "passed", passed: true, error_message: null };
  const summaries = summarizeFindings(findings, minCvss);
  const urgent = summaries.filter((s) => s.urgent);
  const rest = summaries.filter((s) => !s.urgent);
  const parts: string[] = [];
  if (urgent.length) parts.push(`Serious, no login needed: ${urgent.map(describe).join("; ")}`);
  if (rest.length) parts.push(`${urgent.length ? "Also known" : "Known"} vulnerabilities: ${rest.map(describe).join("; ")}`);
  let message = parts.join(". ");
  if (message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE - 1)}…`;
  return { ...base, status: urgent.length ? "failed" : "warning", passed: false, error_message: message };
}
