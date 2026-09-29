// Domain expiry from the domain registry's public RDAP service (the modern
// WHOIS). IANA publishes which RDAP server serves each TLD. Pure, so it can be tested.
import type { CheckOutcome } from "./evaluate.ts";

/** Warning at or under this many days before the registration expires. */
export const DOMAIN_WARNING_DAYS = 30;
/** Failed at or under this many (renewal is urgent: the site and email go down with it). */
export const DOMAIN_FAILURE_DAYS = 7;

export const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

/** Names to look up for a hostname, most likely first: "www.shop.example.co.uk" → example.co.uk ... */
export function domainCandidates(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return [];
  // Try the last two labels, then three (e.g. .co.uk, .com.au, .com.br), without a public suffix list.
  return [labels.slice(-2).join("."), ...(labels.length >= 3 ? [labels.slice(-3).join(".")] : [])];
}

/** The RDAP base URL (https only) for a domain's TLD, from IANA's bootstrap file. */
export function rdapBaseFor(domain: string, bootstrap: unknown): string | null {
  const tld = domain.split(".").at(-1);
  const services = (bootstrap as { services?: unknown })?.services;
  if (!tld || !Array.isArray(services)) return null;
  for (const service of services) {
    if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
    if (!(service[0] as unknown[]).some((t) => typeof t === "string" && t.toLowerCase() === tld)) continue;
    const url = (service[1] as unknown[]).find((u): u is string => typeof u === "string" && u.startsWith("https://"));
    if (url) return url.endsWith("/") ? url : `${url}/`;
  }
  return null;
}

export interface DomainInfo {
  domain: string;
  expiresAt: string | null;
  registrar: string | null;
  /** RDAP statuses, e.g. "client transfer prohibited", "redemption period". */
  statuses: string[];
}

/** Expiry date, registrar and statuses from an RDAP domain response. */
export function parseRdap(domain: string, body: unknown): DomainInfo {
  const r = (body ?? {}) as { events?: unknown; entities?: unknown; status?: unknown };
  const events = Array.isArray(r.events) ? (r.events as { eventAction?: unknown; eventDate?: unknown }[]) : [];
  const expiry = events.find((e) => e.eventAction === "expiration" && typeof e.eventDate === "string");
  const entities = Array.isArray(r.entities)
    ? (r.entities as { roles?: unknown; vcardArray?: unknown }[])
    : [];
  const registrar = entities.find((e) => Array.isArray(e.roles) && e.roles.includes("registrar"));
  const vcard = Array.isArray(registrar?.vcardArray) ? (registrar.vcardArray[1] as unknown[]) : [];
  const fn = Array.isArray(vcard) ? (vcard.find((v) => Array.isArray(v) && v[0] === "fn") as unknown[] | undefined) : undefined;
  return {
    domain,
    expiresAt: expiry && !Number.isNaN(Date.parse(expiry.eventDate as string)) ? new Date(expiry.eventDate as string).toISOString() : null,
    registrar: typeof fn?.[3] === "string" ? fn[3].slice(0, 200) : null,
    statuses: Array.isArray(r.status) ? (r.status as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 20) : [],
  };
}

export function daysLeft(expiresAt: string, now: Date): number {
  return Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function evaluateDomain(info: DomainInfo, now: Date, responseTimeMs: number): CheckOutcome {
  const base = { http_status: null, response_time_ms: Math.round(responseTimeMs) };
  const fail = (message: string): CheckOutcome => ({ ...base, status: "failed", passed: false, error_message: message });
  const warn = (message: string): CheckOutcome => ({ ...base, status: "warning", passed: false, error_message: message });
  const trouble = info.statuses.find((s) => /redemption|pending delete/i.test(s));
  if (trouble) return fail(`Domain ${info.domain} is in "${trouble}": it has expired and will be deleted unless restored`);
  if (!info.expiresAt) return warn(`The registry didn't give an expiry date for ${info.domain}`);
  const days = daysLeft(info.expiresAt, now);
  if (days < 0) {
    const ago = Math.floor((now.getTime() - new Date(info.expiresAt).getTime()) / 86_400_000);
    return fail(`Domain ${info.domain} expired ${ago < 1 ? "today" : `${plural(ago, "day")} ago`}`);
  }
  if (days <= DOMAIN_FAILURE_DAYS) return fail(`Domain ${info.domain} expires in ${plural(days, "day")}`);
  if (days <= DOMAIN_WARNING_DAYS) return warn(`Domain ${info.domain} expires in ${plural(days, "day")}`);
  return { ...base, status: "passed", passed: true, error_message: null };
}
