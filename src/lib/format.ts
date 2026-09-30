// Dates render on the server, so use a fixed business timezone rather than the server's.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";

const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
});
const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const full = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "long",
});

/** "11:43 AM" for today, otherwise "Sep 19, 11:43 AM". */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (dayKey.format(date) === dayKey.format(now)) return timeOnly.format(date);
  return dateTime.format(date);
}

export function formatFull(iso: string): string {
  return full.format(new Date(iso));
}

/** "12 min ago", or "in 3 min" for future times (e.g. next scheduled check). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  const future = diff < 0;
  const minutes = Math.abs(diff);
  if (minutes < 1) return future ? "in under a minute" : "just now";
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
  if (minutes < 60) return wrap(`${minutes} min`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return wrap(`${hours} hr`);
  const days = Math.floor(hours / 24);
  return wrap(`${days} day${days === 1 ? "" : "s"}`);
}

export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} hr`;
}

/** Hostname + path without protocol, for compact display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isInFuture(iso: string | null, now: Date = new Date()): boolean {
  return iso !== null && new Date(iso).getTime() > now.getTime();
}

/** "Jane Doe" → "JD", "jane.doe@figmints.com" → "JD". */
export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/** "99.8%" from passed/total checks; null when there were no checks. */
export function formatUptime(passed: number, checks: number): string | null {
  if (checks === 0) return null;
  const pct = (passed / checks) * 100;
  if (pct === 100) return "100%";
  // Never round a real failure up to 100%.
  return `${Math.min(Math.floor(pct * 10) / 10, 99.9).toFixed(1)}%`;
}

export interface CertificateInfo {
  validTo: string;
  daysLeft: number | null;
  issuer: string | null;
}

/** Certificate details from an SSL monitor's latest check metadata. */
export function certificateInfo(metadata: Record<string, unknown> | null | undefined): CertificateInfo | null {
  if (!metadata || typeof metadata.valid_to !== "string") return null;
  return {
    validTo: metadata.valid_to,
    daysLeft: typeof metadata.days_left === "number" ? metadata.days_left : null,
    issuer: typeof metadata.issuer === "string" ? metadata.issuer : null,
  };
}

const dateOnly = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

export interface LinkScanInfo {
  checked: number;
  found: number;
  unverified: number;
  broken: { url: string; kind: string; text: string | null; reason: string }[];
}

/** Results of a broken link scan from its latest check metadata. */
export function linkScanInfo(metadata: Record<string, unknown> | null | undefined): LinkScanInfo | null {
  if (!metadata || typeof metadata.links_checked !== "number") return null;
  const broken = Array.isArray(metadata.broken_links) ? (metadata.broken_links as LinkScanInfo["broken"]) : [];
  return {
    checked: metadata.links_checked,
    found: typeof metadata.links_found === "number" ? metadata.links_found : metadata.links_checked,
    unverified: typeof metadata.links_unverified === "number" ? metadata.links_unverified : 0,
    broken,
  };
}

export interface TrackingInfo {
  found: Record<string, string[]>;
  expected: string[];
  missing: string[];
}

/** Results of a tracking tag check from its latest check metadata. */
export function trackingInfo(metadata: Record<string, unknown> | null | undefined): TrackingInfo | null {
  if (!metadata || typeof metadata.tags_found !== "object" || metadata.tags_found === null) return null;
  const found = metadata.tags_found as Record<string, string[]>;
  const expected = Array.isArray(metadata.tags_expected) ? (metadata.tags_expected as string[]) : [];
  return { found, expected, missing: expected.filter((t) => !found[t]) };
}

export interface WordPressFatalError {
  first_at: string | null;
  last_at: string | null;
  count: number;
  message: string;
  file: string;
  line: number;
  /** Plugin or theme name, or "WordPress core". */
  source: string;
}

export interface WordPressInfo {
  version: string | null;
  latest: string | null;
  source: string | null;
  php: string | null;
  themes: string[];
  plugins: { slug: string; name?: string; version: string | null; latest: string | null; source: string; active?: boolean }[];
  /** From the Website Watch Health plugin, when it answered. */
  report: {
    generated_at: string | null;
    updates_checked_at: string | null;
    memory_limit: string | null;
    /** The Website Watch Health plugin's own version. */
    plugin_version?: string | null;
    themes: { slug: string; name: string; version: string | null; latest: string | null; active: boolean }[];
    /** Last 7 days, newest first; null or missing when the site's plugin is older than 1.2. */
    fatal_errors?: WordPressFatalError[] | null;
  } | null;
  pluginNote: string | null;
  wpengine: {
    install: string;
    environment: string;
    status: string;
    last_backup_at: string | null;
    latest_backup_status: string | null;
    upgrades_deferred_until: string | null;
  } | null;
  note: string | null;
  problems: { level: "critical" | "warning"; message: string }[];
}

/** Results of a WordPress health check from its latest check metadata. */
export function wordpressInfo(metadata: Record<string, unknown> | null | undefined): WordPressInfo | null {
  if (!metadata || typeof metadata.wordpress !== "object" || metadata.wordpress === null) return null;
  const wp = metadata.wordpress as { version?: string | null; latest?: string | null; source?: string | null };
  return {
    version: wp.version ?? null,
    latest: wp.latest ?? null,
    source: wp.source ?? null,
    php: typeof metadata.php_version === "string" ? metadata.php_version : null,
    themes: Array.isArray(metadata.themes) ? (metadata.themes as string[]) : [],
    plugins: Array.isArray(metadata.plugins) ? (metadata.plugins as WordPressInfo["plugins"]) : [],
    wpengine: (metadata.wpengine as WordPressInfo["wpengine"]) ?? null,
    report: (metadata.plugin_report as WordPressInfo["report"]) ?? null,
    pluginNote: typeof metadata.plugin_note === "string" ? metadata.plugin_note : null,
    note: typeof metadata.wpengine_note === "string" ? metadata.wpengine_note : null,
    problems: Array.isArray(metadata.problems) ? (metadata.problems as WordPressInfo["problems"]) : [],
  };
}

export interface VulnerabilityInfo {
  feedRefreshedAt: string | null;
  inventoryCheckedAt: string | null;
  /** "complete": the site plugin listed everything; "partial": public signals only. */
  coverage: "complete" | "partial" | null;
  checked: number;
  unknownVersions: number;
  minCvss: number;
  software: {
    type: "core" | "plugin" | "theme";
    slug: string;
    name: string;
    version: string;
    active: boolean | null;
    count: number;
    worstScore: number | null;
    urgent: boolean;
    updateTo: string | null;
  }[];
  findings: {
    id: string;
    title: string;
    url: string;
    type: "core" | "plugin" | "theme";
    slug: string;
    name: string;
    version: string;
    cvss: number | null;
    rating: string | null;
    no_login: boolean;
    urgent: boolean;
    fixed_in: string | null;
  }[];
  totalFindings: number;
}

/** Results of a Vulnerabilities check from its latest check metadata. */
export function vulnerabilityInfo(metadata: Record<string, unknown> | null | undefined): VulnerabilityInfo | null {
  const v = metadata?.vulnerabilities;
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  const num = (x: unknown) => (typeof x === "number" ? x : 0);
  return {
    feedRefreshedAt: str(m.feed_refreshed_at),
    inventoryCheckedAt: str(m.inventory_checked_at),
    coverage: m.coverage === "complete" || m.coverage === "partial" ? m.coverage : null,
    checked: num(m.checked),
    unknownVersions: num(m.unknown_versions),
    minCvss: num(m.min_cvss),
    software: Array.isArray(m.software) ? (m.software as VulnerabilityInfo["software"]) : [],
    findings: Array.isArray(m.findings) ? (m.findings as VulnerabilityInfo["findings"]) : [],
    totalFindings: num(m.total_findings),
  };
}

export interface VisibilityInfo {
  noindex: string | null;
  robotsStatus: number | null;
  robotsBlocks: boolean;
  foreignCanonical: string | null;
}

/** Results of a search visibility check from its latest check metadata. */
export function visibilityInfo(metadata: Record<string, unknown> | null | undefined): VisibilityInfo | null {
  if (!metadata || !("robots_blocks" in metadata)) return null;
  return {
    noindex: typeof metadata.noindex === "string" ? metadata.noindex : null,
    robotsStatus: typeof metadata.robots_status === "number" ? metadata.robots_status : null,
    robotsBlocks: metadata.robots_blocks === true,
    foreignCanonical: typeof metadata.foreign_canonical === "string" ? metadata.foreign_canonical : null,
  };
}

export interface DomainExpiryInfo {
  domain: string;
  expiresAt: string | null;
  daysLeft: number | null;
  registrar: string | null;
  statuses: string[];
}

/** Results of a domain expiry check from its latest check metadata. */
export function domainExpiryInfo(metadata: Record<string, unknown> | null | undefined): DomainExpiryInfo | null {
  if (!metadata || typeof metadata.domain !== "string") return null;
  return {
    domain: metadata.domain,
    expiresAt: typeof metadata.expires_at === "string" ? metadata.expires_at : null,
    daysLeft: typeof metadata.days_left === "number" ? metadata.days_left : null,
    registrar: typeof metadata.registrar === "string" ? metadata.registrar : null,
    statuses: Array.isArray(metadata.statuses) ? (metadata.statuses as string[]) : [],
  };
}

export interface PageSpeedInfo {
  score: number | null;
  lab: { fcpMs: number | null; lcpMs: number | null; tbtMs: number | null; cls: number | null; speedIndexMs: number | null };
  field: {
    source: "page" | "origin";
    lcp: { p75: number; category: string | null } | null;
    inp: { p75: number; category: string | null } | null;
    cls: { p75: number; category: string | null } | null;
  } | null;
  opportunities: { title: string; savingsMs: number }[];
  finalUrl: string | null;
}

/** Results of a page speed check from its latest check metadata. */
export function pageSpeedInfo(metadata: Record<string, unknown> | null | undefined): PageSpeedInfo | null {
  if (!metadata || !("score" in metadata) || typeof metadata.lab !== "object" || metadata.lab === null) return null;
  return {
    score: typeof metadata.score === "number" ? metadata.score : null,
    lab: metadata.lab as PageSpeedInfo["lab"],
    field: (metadata.field as PageSpeedInfo["field"]) ?? null,
    opportunities: Array.isArray(metadata.opportunities) ? (metadata.opportunities as PageSpeedInfo["opportunities"]) : [],
    finalUrl: typeof metadata.final_url === "string" ? metadata.final_url : null,
  };
}

/** "2.4 s" from milliseconds. */
export function formatSeconds(ms: number | null | undefined): string {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "–";
}

export interface ContactFormInfo {
  forms: { builder: string; id: string | null; fields: number; hasSubmit: boolean }[];
  embeds: { builder: string; id: string | null; scriptUrl: string | null }[];
  hubspot: { id: string; status: "ok" | "missing" | "unpublished" | "unknown"; fields: number | null }[];
  errors: string[];
  captcha: boolean;
  mail: {
    failures: { lastAt: string | null; count: number; message: string }[];
    lastSentAt: string | null;
    test: { configured: boolean; lastAt: string | null; ok: boolean | null; error: string | null };
  } | null;
  pluginNote: string | null;
}

/** Results of a contact form check from its latest check metadata. */
export function contactFormInfo(metadata: Record<string, unknown> | null | undefined): ContactFormInfo | null {
  if (!metadata || !Array.isArray(metadata.forms)) return null;
  return {
    forms: metadata.forms as ContactFormInfo["forms"],
    embeds: Array.isArray(metadata.embeds) ? (metadata.embeds as ContactFormInfo["embeds"]) : [],
    hubspot: Array.isArray(metadata.hubspot_forms) ? (metadata.hubspot_forms as ContactFormInfo["hubspot"]) : [],
    errors: Array.isArray(metadata.form_errors) ? (metadata.form_errors as string[]) : [],
    captcha: metadata.captcha === true,
    mail: (metadata.mail as ContactFormInfo["mail"]) ?? null,
    pluginNote: typeof metadata.plugin_note === "string" ? metadata.plugin_note : null,
  };
}
