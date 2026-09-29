// WordPress health: public-signal detection, version comparison, and the rules
// for WP Engine data (backups, PHP, install status). Pure (relative imports only)
// so everything here can be tested directly.
import { DEFAULT_SETTINGS, type AppSettings } from "../settings.ts";
import type { CheckOutcome } from "./evaluate.ts";

// Public signals ------------------------------------------------------------------

export interface DetectedPlugin {
  slug: string;
  /** Only when the page reveals it (asset ?ver=). */
  version: string | null;
  source: "asset" | "rest";
}

export interface WordPressSignals {
  isWordPress: boolean;
  version: string | null;
  versionSource: "feed" | "meta" | "assets" | null;
  themes: string[];
  plugins: DetectedPlugin[];
}

// REST namespaces that identify common plugins (namespace prefix → wordpress.org slug).
const NAMESPACE_PLUGINS: [string, string][] = [
  ["yoast/", "wordpress-seo"],
  ["rankmath/", "seo-by-rank-math"],
  ["redirection/", "redirection"],
  ["akismet/", "akismet"],
  ["tribe/events/", "the-events-calendar"],
  ["duplicate-post/", "duplicate-post"],
  ["gf/", "gravityforms"],
  ["wc/", "woocommerce"],
  ["contact-form-7/", "contact-form-7"],
  ["elementor/", "elementor"],
  ["jetpack/", "jetpack"],
  ["wordfence/", "wordfence"],
  ["wpforms/", "wpforms-lite"],
  ["litespeed/", "litespeed-cache"],
  ["acf/", "advanced-custom-fields"],
  ["regenerate-thumbnails/", "regenerate-thumbnails"],
];

const VERSION = /^\d+(?:\.\d+){0,3}$/;

/**
 * What a site reveals publicly: WordPress version (RSS feed generator, then meta
 * generator, then wp-includes asset versions), themes, and plugins seen in asset
 * URLs or REST API namespaces. Best-effort by nature.
 */
export function detectWordPress(html: string, feedXml: string | null, restNamespaces: string[] | null): WordPressSignals {
  const feed = feedXml?.match(/<generator>\s*https?:\/\/wordpress\.org\/\?v=([\d.]+)\s*<\/generator>/i)?.[1] ?? null;
  const meta = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress\s+([\d.]+)/i)?.[1] ?? null;
  const assetVersions = [...html.matchAll(/\/wp-includes\/[^"'\s?]+\?ver=([\d.]+)/g)].map((m) => m[1]).filter((v) => VERSION.test(v));
  const assets = assetVersions.length ? mostCommon(assetVersions) : null;

  const version = feed ?? meta ?? assets;
  const versionSource = feed ? "feed" : meta ? "meta" : assets ? "assets" : null;

  const themes = [...new Set([...html.matchAll(/\/wp-content\/themes\/([a-z0-9_-]+)\//gi)].map((m) => m[1].toLowerCase()))];

  const plugins = new Map<string, DetectedPlugin>();
  for (const m of html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\/[^"'\s]*?\?ver=([^"'&\s]+)/gi)) {
    const slug = m[1].toLowerCase();
    const v = VERSION.test(m[2]) ? m[2] : null;
    const prev = plugins.get(slug);
    // Prefer a real version number over a cache-busting hash.
    if (!prev || (!prev.version && v)) plugins.set(slug, { slug, version: v, source: "asset" });
  }
  for (const m of html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\//gi)) {
    const slug = m[1].toLowerCase();
    if (!plugins.has(slug)) plugins.set(slug, { slug, version: null, source: "asset" });
  }
  for (const ns of restNamespaces ?? []) {
    const hit = NAMESPACE_PLUGINS.find(([prefix]) => ns.startsWith(prefix));
    if (hit && !plugins.has(hit[1])) plugins.set(hit[1], { slug: hit[1], version: null, source: "rest" });
  }

  const isWordPress =
    Boolean(version) || themes.length > 0 || plugins.size > 0 || /\/wp-(?:content|includes)\//.test(html) || Boolean(restNamespaces?.includes("wp/v2"));
  return { isWordPress, version, versionSource, themes, plugins: [...plugins.values()].sort((a, b) => a.slug.localeCompare(b.slug)) };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Versions ------------------------------------------------------------------------

/** Numeric dotted-version compare: negative when a < b. "7.1" equals "7.1.0". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// WP Engine -------------------------------------------------------------------------

export interface WpeInstall {
  id: string;
  name: string;
  environment: string;
  status: string;
  php_version: string | null;
  wp_version: string | null;
  primary_domain: string | null;
  cname: string | null;
  defer_wordpress_upgrades_until: string | null;
}

export interface WpeBackup {
  id: string;
  status: "requested" | "in_progress" | "completed" | "aborted" | string;
  create_time: string | null;
  complete_time: string | null;
  /** WordPress version at backup time (the installs endpoint doesn't return one). */
  wordpress_version: string | null;
}

export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/** The install serving this hostname (primary domain first, then the WP Engine cname). */
export function matchInstall(installs: WpeInstall[], hostname: string): WpeInstall | null {
  const host = bareHost(hostname);
  return (
    installs.find((i) => i.primary_domain && bareHost(i.primary_domain) === host) ??
    installs.find((i) => i.cname && bareHost(i.cname) === host) ??
    null
  );
}

export interface BackupStatus {
  lastCompletedAt: string | null;
  latestStatus: string | null;
  latestAt: string | null;
  wordpressVersion: string | null;
}

/** Real API responses leave create_time as the zero date (0001-01-01), so fall back to complete_time. */
function backupTime(b: WpeBackup): string | null {
  const created = b.create_time && !b.create_time.startsWith("0001-") ? b.create_time : null;
  return created ?? b.complete_time;
}

export function summarizeBackups(backups: WpeBackup[]): BackupStatus {
  const newest = (list: WpeBackup[]) =>
    list.filter((b) => backupTime(b)).sort((a, b) => backupTime(b)!.localeCompare(backupTime(a)!))[0];
  const latest = newest(backups);
  const completed = newest(backups.filter((b) => b.status === "completed" && b.complete_time));
  return {
    lastCompletedAt: completed?.complete_time ?? null,
    latestStatus: latest?.status ?? null,
    latestAt: latest ? backupTime(latest) : null,
    wordpressVersion: completed?.wordpress_version ?? null,
  };
}

// Website Watch Health plugin (Stage B) ----------------------------------------------

export interface PluginReportItem {
  /** Plugin file (e.g. "gravityforms/gravityforms.php") or theme folder. */
  id: string;
  name: string;
  version: string | null;
  active: boolean;
  /** Version WordPress offers as an update, if any. */
  update: string | null;
}

export interface FatalError {
  firstAt: string | null;
  lastAt: string | null;
  /** Approximate: the plugin records at most one error every 10 seconds. */
  count: number;
  message: string;
  /** Relative to the site, e.g. "wp-content/plugins/gravityforms/x.php". */
  file: string;
  line: number;
}

export interface PluginReport {
  pluginVersion: string | null;
  generatedAt: string | null;
  wordpress: { version: string | null; update: string | null; checkedAt: string | null };
  php: { version: string | null; memoryLimit: string | null };
  debugDisplay: boolean;
  cron: { disabled: boolean; overdueMinutes: number | null };
  plugins: PluginReportItem[];
  pluginsCheckedAt: string | null;
  themes: PluginReportItem[];
  /** Fatal PHP errors from the last 7 days; null when the plugin is older than 1.2. */
  fatalErrors: FatalError[] | null;
}

const MAX_REPORT_ITEMS = 300;
const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function reportItems(v: unknown, idKey: "file" | "slug"): PluginReportItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_REPORT_ITEMS).flatMap((raw) => {
    const item = obj(raw);
    const id = text(item[idKey]);
    if (!id) return [];
    return [{ id, name: text(item.name) ?? id, version: text(item.version, 40), active: item.active === true, update: text(item.update, 40) }];
  });
}

/** Validates the plugin's JSON; null when it isn't a Website Watch Health report. */
export function parsePluginReport(body: unknown): PluginReport | null {
  const r = obj(body);
  const wp = obj(r.wordpress);
  if (!("plugins" in r) || typeof wp.version !== "string") return null;
  const php = obj(r.php);
  const cron = obj(r.cron);
  const overdue = cron.overdue_minutes;
  return {
    pluginVersion: text(r.plugin_version, 20),
    generatedAt: text(r.generated_at, 40),
    wordpress: { version: text(wp.version, 40), update: text(wp.update, 40), checkedAt: text(wp.checked_at, 40) },
    php: { version: text(php.version, 40), memoryLimit: text(php.memory_limit, 20) },
    debugDisplay: r.debug_display === true,
    cron: {
      disabled: cron.disabled === true,
      overdueMinutes: typeof overdue === "number" && Number.isFinite(overdue) ? Math.max(0, Math.round(overdue)) : null,
    },
    plugins: reportItems(r.plugins, "file"),
    pluginsCheckedAt: text(r.plugins_checked_at, 40),
    themes: reportItems(r.themes, "slug"),
    fatalErrors: Array.isArray(r.fatal_errors) ? fatalErrors(r.fatal_errors) : null,
  };
}

function fatalErrors(v: unknown[]): FatalError[] {
  return v.slice(0, 50).flatMap((raw) => {
    const e = obj(raw);
    const message = text(e.message, 300);
    if (!message) return [];
    const count = typeof e.count === "number" && Number.isFinite(e.count) ? Math.max(1, Math.round(e.count)) : 1;
    const line = typeof e.line === "number" && Number.isFinite(e.line) ? Math.max(0, Math.round(e.line)) : 0;
    return [{ firstAt: text(e.first_at, 40), lastAt: text(e.last_at, 40), count, message, file: text(e.file, 300) ?? "", line }];
  });
}

/** Where an error happened: the plugin or theme folder in its path, or WordPress itself. */
export function fatalErrorSource(file: string): { kind: "plugin" | "theme" | "core" | "other"; slug: string | null } {
  const plugin = file.match(/^wp-content\/(?:mu-)?plugins\/([^/]+)/);
  if (plugin) return { kind: "plugin", slug: plugin[1].replace(/\.php$/, "") };
  const theme = file.match(/^wp-content\/themes\/([^/]+)/);
  if (theme) return { kind: "theme", slug: theme[1] };
  if (/^wp-(includes|admin)\//.test(file)) return { kind: "core", slug: null };
  return { kind: "other", slug: null };
}

/** A readable name for where an error happened, using the report's plugin and theme names. */
export function fatalErrorSourceName(file: string, report: Pick<PluginReport, "plugins" | "themes">): string {
  const source = fatalErrorSource(file);
  if (source.kind === "core") return "WordPress core";
  if (source.kind === "plugin") {
    const match = report.plugins.find((p) => p.id.split("/")[0].replace(/\.php$/, "") === source.slug);
    return match?.name ?? `plugin ${source.slug}`;
  }
  if (source.kind === "theme") {
    const match = report.themes.find((t) => t.id === source.slug);
    return match?.name ?? `theme ${source.slug}`;
  }
  return file || "unknown file";
}

/** WP-Cron this far behind means WordPress's own update checks aren't running. */
export const CRON_OVERDUE_WARNING_MINUTES = 120;
/** WordPress normally checks for updates twice a day. */
export const UPDATES_STALE_HOURS = 72;
/** Fatal errors this recent make the check fail (Critical by default, so Slack hears about it). */
export const FATAL_WINDOW_HOURS = 24;

// Evaluation ------------------------------------------------------------------------

export interface WordPressFacts {
  /** From WP Engine when linked, otherwise from public signals. */
  wpVersion: string | null;
  latestWpVersion: string | null;
  phpVersion: string | null;
  /** Only when a WP Engine install is linked. */
  install: Pick<WpeInstall, "status" | "defer_wordpress_upgrades_until"> | null;
  backups: BackupStatus | null;
  /** Plugins where the site's version is known and older than wordpress.org's. */
  outdatedPlugins: { slug: string; version: string; latest: string }[];
  isWordPress: boolean;
  /** From the Website Watch Health plugin, when installed. */
  report?: PluginReport | null;
}

export interface WordPressProblem {
  level: "critical" | "warning";
  message: string;
}

/** The Settings that shape these rules (backup age, minimum PHP, whether updates warn). */
export type WordPressRules = Pick<AppSettings, "backupMaxAgeHours" | "minPhpVersion" | "warnOnUpdates">;

export function wordpressProblems(f: WordPressFacts, now: Date, rules: WordPressRules = DEFAULT_SETTINGS): WordPressProblem[] {
  const problems: WordPressProblem[] = [];
  if (f.backups) {
    const age = f.backups.lastCompletedAt ? (now.getTime() - new Date(f.backups.lastCompletedAt).getTime()) / 3_600_000 : null;
    if (age === null) problems.push({ level: "critical", message: "No completed WP Engine backup found" });
    else if (age > rules.backupMaxAgeHours) {
      problems.push({ level: "critical", message: `Last completed backup was ${Math.floor(age)} hours ago` });
    }
    if (f.backups.latestStatus === "aborted") problems.push({ level: "critical", message: "Latest backup was aborted" });
  }
  if (f.install && f.install.status !== "active") {
    problems.push({ level: "warning", message: `WP Engine install is ${f.install.status}` });
  }
  const deferred = f.install?.defer_wordpress_upgrades_until && new Date(f.install.defer_wordpress_upgrades_until) > now;
  // With updates not counting as warnings (Settings), they're still listed, just not flagged.
  if (rules.warnOnUpdates && f.wpVersion && f.latestWpVersion && compareVersions(f.wpVersion, f.latestWpVersion) < 0 && !deferred) {
    problems.push({ level: "warning", message: `WordPress ${f.wpVersion} (latest is ${f.latestWpVersion})` });
  }
  if (rules.minPhpVersion && f.phpVersion && compareVersions(f.phpVersion, rules.minPhpVersion) < 0) {
    problems.push({ level: "warning", message: `PHP ${f.phpVersion} is below the minimum (${rules.minPhpVersion})` });
  }
  if (rules.warnOnUpdates && f.outdatedPlugins.length > 0) {
    const n = f.outdatedPlugins.length;
    problems.push({ level: "warning", message: `${n} plugin${n === 1 ? "" : "s"} with updates available` });
  }
  if (f.report?.fatalErrors) {
    const report = f.report;
    const recent = (report.fatalErrors ?? []).filter(
      (e) => e.lastAt && (now.getTime() - new Date(e.lastAt).getTime()) / 3_600_000 <= FATAL_WINDOW_HOURS,
    );
    if (recent.length > 0) {
      const total = recent.reduce((n, e) => n + e.count, 0);
      const sources = [...new Set(recent.map((e) => fatalErrorSourceName(e.file, report)))];
      problems.push({
        level: "critical",
        message: `${total} fatal PHP error${total === 1 ? "" : "s"} in the last ${FATAL_WINDOW_HOURS} hours (${sources.join(", ")})`,
      });
    }
  }
  if (f.report) {
    const themes = f.report.themes.filter((t) => t.update).length;
    if (rules.warnOnUpdates && themes > 0) problems.push({ level: "warning", message: `${themes} theme${themes === 1 ? "" : "s"} with updates available` });
    if (f.report.debugDisplay) {
      problems.push({ level: "warning", message: "Debug mode shows PHP errors to visitors (WP_DEBUG_DISPLAY)" });
    }
    const overdue = f.report.cron.overdueMinutes;
    if (overdue !== null && overdue > CRON_OVERDUE_WARNING_MINUTES) {
      problems.push({ level: "warning", message: `WP-Cron is ${Math.floor(overdue / 60)} hours behind` });
    }
    const checked = f.report.pluginsCheckedAt ? new Date(f.report.pluginsCheckedAt).getTime() : NaN;
    if (Number.isNaN(checked) || (now.getTime() - checked) / 3_600_000 > UPDATES_STALE_HOURS) {
      problems.push({ level: "warning", message: "WordPress hasn't checked for plugin updates in 3 days, so updates may be missing" });
    }
  }
  if (!f.isWordPress && !f.install && !f.report) {
    problems.push({ level: "warning", message: "WordPress not detected on this page" });
  }
  return problems;
}

/** Failed when anything is critical (backups), warning for updates, passed otherwise. */
export function evaluateWordPress(problems: WordPressProblem[], responseTimeMs: number, pageStatus: number | null): CheckOutcome {
  const base = { http_status: pageStatus, response_time_ms: Math.round(responseTimeMs) };
  if (problems.length === 0) return { ...base, status: "passed", passed: true, error_message: null };
  const critical = problems.some((p) => p.level === "critical");
  const ordered = [...problems.filter((p) => p.level === "critical"), ...problems.filter((p) => p.level === "warning")];
  return {
    ...base,
    status: critical ? "failed" : "warning",
    passed: false,
    error_message: ordered.map((p) => p.message).join("; "),
  };
}
