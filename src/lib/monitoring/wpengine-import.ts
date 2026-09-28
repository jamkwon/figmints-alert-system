// Import from WP Engine: which production installs aren't monitored yet, and the
// client each one would go under. Pure, so it can be tested without the API.
import { bareHost, type WpeInstall } from "./wordpress.ts";

export interface WpeSite {
  id: string;
  name: string;
  sandbox: boolean;
  installIds: string[];
}

export interface ImportCandidate {
  installId: string;
  installName: string;
  /** WP Engine site name: the suggested client name. */
  siteName: string;
  domain: string;
  url: string;
  /** Only a *.wpengine.com / *.wpenginepowered.com address: usually not launched, or the domain isn't set. */
  wpeDomainOnly: boolean;
  sandbox: boolean;
  /** Client that already monitors this domain, if any. */
  monitoredBy: string | null;
  /** Existing client with the same name as the site, reused on import. */
  existingClient: string | null;
}

export interface ExistingWebsite {
  url: string;
  clientName: string;
}

const WPE_HOSTS = /\.(wpengine|wpenginepowered)\.com$/i;

function hostOf(url: string): string | null {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Production installs as import rows: not yet monitored first, then by name. */
export function buildCandidates(
  installs: WpeInstall[],
  sites: WpeSite[],
  websites: ExistingWebsite[],
  clientNames: string[],
): ImportCandidate[] {
  const siteByInstall = new Map(sites.flatMap((s) => s.installIds.map((id) => [id, s] as const)));
  const monitored = new Map<string, string>();
  for (const w of websites) {
    const host = hostOf(w.url);
    if (host && !monitored.has(host)) monitored.set(host, w.clientName);
  }
  const clients = new Map(clientNames.map((n) => [n.trim().toLowerCase(), n]));

  return installs
    .filter((i) => i.environment === "production" && (i.primary_domain || i.cname))
    .map((i) => {
      const domain = (i.primary_domain ?? i.cname)!.toLowerCase();
      const site = siteByInstall.get(i.id);
      const siteName = site?.name.trim() || i.name;
      const hosts = [domain, i.cname].filter((h): h is string => Boolean(h)).map(bareHost);
      return {
        installId: i.id,
        installName: i.name,
        siteName,
        domain,
        url: `https://${domain}/`,
        wpeDomainOnly: WPE_HOSTS.test(domain),
        sandbox: site?.sandbox ?? false,
        monitoredBy: hosts.map((h) => monitored.get(h)).find(Boolean) ?? null,
        existingClient: clients.get(siteName.toLowerCase()) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.monitoredBy)) - Number(Boolean(b.monitoredBy)) ||
        a.siteName.localeCompare(b.siteName, "en", { sensitivity: "base" }),
    );
}

/** Ticked by default: a real domain, not a sandbox, not monitored yet. */
export function isSuggested(c: ImportCandidate): boolean {
  return !c.monitoredBy && !c.wpeDomainOnly && !c.sandbox;
}

/** Scheduled checks per day for monitors at these intervals (minutes). */
export function checksPerDay(intervals: number[]): number {
  return Math.round(intervals.reduce((sum, m) => sum + 1440 / m, 0));
}

/** SSL and WordPress checks added on import run every 6 hours, like the ones added from forms. */
export const IMPORT_EXTRA_INTERVAL = 360;
export const MAX_IMPORT = 300;

export interface ImportChecks {
  uptime: boolean;
  ssl: boolean;
  wordpress: boolean;
  /** Uptime interval in minutes. */
  interval: number;
  severity: string;
}

/**
 * Monitor rows for one imported website. First checks are spread over each
 * interval (`random` in [0, 1)) so a big import doesn't make everything due at once.
 */
export function monitorsForImport(
  website: { id: string; url: string },
  checks: ImportChecks,
  now: number,
  random: () => number = Math.random,
) {
  const origin = new URL(website.url).origin + "/";
  const rows = [
    ...(checks.uptime
      ? [{ name: "Homepage", monitor_type: "http_status", target_url: website.url, interval_minutes: checks.interval }]
      : []),
    ...(checks.ssl
      ? [{ name: "SSL Certificate", monitor_type: "ssl_expiry", target_url: origin, interval_minutes: IMPORT_EXTRA_INTERVAL }]
      : []),
    ...(checks.wordpress
      ? [{ name: "WordPress Health", monitor_type: "wordpress_health", target_url: origin, interval_minutes: IMPORT_EXTRA_INTERVAL }]
      : []),
  ];
  return rows.map((m) => ({
    ...m,
    website_id: website.id,
    severity_on_failure: checks.severity,
    next_check_at: new Date(now + random() * m.interval_minutes * 60_000).toISOString(),
  }));
}
