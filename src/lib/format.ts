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
