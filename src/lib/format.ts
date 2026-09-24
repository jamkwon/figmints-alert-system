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
