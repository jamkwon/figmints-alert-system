// Performs one HTTP check for a monitor. Never throws: failures become a failed outcome.
import type { KeyObject } from "node:crypto";
import { isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { Agent, fetch, type Response } from "undici";
import type { Monitor } from "../types.ts";
import {
  daysUntil,
  evaluateCertificate,
  evaluateCheck,
  isExpectedStatus,
  type CertificateObservation,
  type CheckOutcome,
  type HttpObservation,
} from "./evaluate.ts";
import { evaluateLinks, extractLinks, judgeLink, reasonFor, type BrokenLink, type LinkResponse } from "./links.ts";
import { detectTags, evaluateTags, isTrackingTag, type TrackingTag } from "./tracking.ts";
import { UnsafeUrlError, safeLookup, validateTargetUrl } from "./url-safety.ts";
import {
  compareVersions,
  detectWordPress,
  fatalErrorSourceName,
  evaluateWordPress,
  matchInstall,
  parsePluginReport,
  summarizeBackups,
  wordpressProblems,
  type BackupStatus,
  type PluginReport,
  type WordPressFacts,
  type WpeInstall,
} from "./wordpress.ts";
import { isWpeConfigured, listBackups, listInstalls } from "./wpengine.ts";
import { WP_PLUGIN_ROUTE, pluginKey, signRequest } from "./wp-plugin.ts";

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "FigmintsWebsiteWatch/1.0 (internal uptime monitor)";

// Every connection goes through safeLookup, so private addresses are refused
// even after redirects or DNS changes.
const agent = new Agent({
  connect: { lookup: safeLookup, timeout: 10_000 },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

export interface CheckMetadata {
  final_url?: string;
  redirects?: number;
  bytes_read?: number;
  truncated?: boolean;
  content_type?: string | null;
  /** SSL monitors */
  valid_to?: string;
  days_left?: number;
  issuer?: string | null;
  subject?: string | null;
  [key: string]: unknown;
}

export interface HttpCheckResult {
  outcome: CheckOutcome;
  metadata: CheckMetadata;
}

async function readBody(response: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) return { text: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
    if (bytes >= MAX_BODY_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
  return { text, bytes, truncated };
}

type ErrorWithCode = Error & { code?: string; cause?: unknown };

/** Turns network/TLS/timeout errors into a short message a non-developer can read. */
export function describeFetchError(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const e = current as ErrorWithCode;
    if (e instanceof UnsafeUrlError) return e.message;
    if (e.name === "TimeoutError" || e.name === "AbortError") return `Timed out after ${TIMEOUT_MS / 1000} s`;
    if (e.name === "TooManyRedirectsError") return e.message;
    switch (e.code) {
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return "DNS lookup failed (domain not found)";
      case "ECONNREFUSED":
        return "Connection refused";
      case "ECONNRESET":
        return "Connection reset by server";
      case "ETIMEDOUT":
      case "UND_ERR_CONNECT_TIMEOUT":
        return "Connection timed out";
      case "UND_ERR_HEADERS_TIMEOUT":
      case "UND_ERR_BODY_TIMEOUT":
        return `Timed out after ${TIMEOUT_MS / 1000} s`;
      case "CERT_HAS_EXPIRED":
        return "SSL certificate has expired";
      case "ERR_TLS_CERT_ALTNAME_INVALID":
        return "SSL certificate does not match the domain";
      case "DEPTH_ZERO_SELF_SIGNED_CERT":
      case "SELF_SIGNED_CERT_IN_CHAIN":
      case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
        return "SSL certificate is not trusted";
    }
    if (e.code?.startsWith("ERR_TLS") || e.code?.startsWith("CERT_")) return `SSL error (${e.code})`;
    if (e.code?.startsWith("ERR_SSL")) return "SSL handshake failed (HTTPS may not be enabled on this address)";
    if (!e.cause) return e.message || "Request failed";
    current = e.cause;
  }
  return "Request failed";
}

class TooManyRedirectsError extends Error {
  constructor() {
    super("Too many redirects");
    this.name = "TooManyRedirectsError";
  }
}

/**
 * Fetches a URL, following up to MAX_REDIRECTS redirects itself so every hop is
 * re-validated (ports, hostnames) on top of the connect-time IP check.
 * Returns the final response (body unread) and URL.
 */
async function safeFetch(
  start: URL,
  options: {
    method?: "GET" | "HEAD" | "POST";
    signal: AbortSignal;
    followRedirects?: boolean;
    accept?: string;
    /** Extra request headers. Don't combine secrets with followRedirects, or they'd go to the redirect target. */
    headers?: Record<string, string>;
  },
): Promise<{ response: Response; url: URL; redirects: number }> {
  let url = start;
  let redirects = 0;
  while (true) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      dispatcher: agent,
      redirect: "manual",
      signal: options.signal,
      headers: {
        ...options.headers,
        "user-agent": USER_AGENT,
        accept: options.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && location;
    if (options.followRedirects === false || !isRedirect) return { response, url, redirects };
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) throw new TooManyRedirectsError();
    url = validateTargetUrl(new URL(location, url).toString());
    redirects++;
  }
}

export async function performHttpCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const metadata: CheckMetadata = {};

  const observe = (partial: Partial<HttpObservation>): HttpObservation => ({
    httpStatus: null,
    statusText: "",
    responseTimeMs: elapsed(),
    body: null,
    error: null,
    ...partial,
  });

  try {
    // A monitor expecting a 3xx is checking the redirect itself, so don't follow it.
    const expected = monitor.expected_status_code;
    const { response, url, redirects } = await safeFetch(validateTargetUrl(monitor.target_url), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      followRedirects: !(expected !== null && expected >= 300 && expected < 400),
    });
    const body = await readBody(response);
    Object.assign(metadata, {
      final_url: url.toString(),
      redirects,
      bytes_read: body.bytes,
      truncated: body.truncated,
      content_type: response.headers.get("content-type"),
    });
    const outcome = evaluateCheck(
      monitor,
      observe({ httpStatus: response.status, statusText: response.statusText, body: body.text }),
    );
    return { outcome, metadata };
  } catch (err) {
    return { outcome: evaluateCheck(monitor, observe({ error: describeFetchError(err) })), metadata };
  }
}

// Broken links ----------------------------------------------------------------------

const LINK_TIMEOUT_MS = 8_000;
// Be gentle with the client's own server: many hosts throttle bursts of requests.
const SAME_SITE_CONCURRENCY = 2;
const EXTERNAL_CONCURRENCY = 6;

/** Network error code anywhere in the cause chain (e.g. ENOTFOUND). */
function errorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (code !== undefined && code !== null && code !== "") return String(code);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

/** One request per link: HEAD, then GET when the server rejects or mishandles HEAD. */
async function probeLink(link: string): Promise<LinkResponse> {
  let url: URL;
  try {
    url = validateTargetUrl(link);
  } catch (err) {
    // Links to private/internal addresses aren't fetched, so they're neither ok nor broken.
    return { status: null, error: { code: "SKIPPED", message: describeFetchError(err) } };
  }
  const attempt = async (method: "HEAD" | "GET") => {
    const { response } = await safeFetch(url, { method, signal: AbortSignal.timeout(LINK_TIMEOUT_MS), accept: "*/*" });
    await response.body?.cancel();
    return response.status;
  };
  try {
    const status = await attempt("HEAD");
    // Some servers answer HEAD with 404/405/5xx even when GET works; confirm before calling it broken.
    if (status === 404 || status === 405 || status === 501 || status >= 500) {
      return { status: await attempt("GET"), error: null };
    }
    return { status, error: null };
  } catch (err) {
    return { status: null, error: { code: errorCode(err), message: describeFetchError(err) } };
  }
}

/** Loads the page, then checks up to MAX_LINKS of its links, images, stylesheets and scripts. */
export async function performBrokenLinksCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  const pageFailed = (partial: Partial<HttpObservation>): HttpCheckResult => ({
    outcome: evaluateCheck(monitor, {
      httpStatus: null,
      statusText: "",
      responseTimeMs: performance.now() - started,
      body: null,
      error: null,
      ...partial,
    }),
    metadata,
  });

  // The page itself must load; otherwise this is a normal failed check.
  let page: { response: Response; url: URL };
  let html: string;
  try {
    page = await safeFetch(validateTargetUrl(monitor.target_url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    html = (await readBody(page.response)).text;
  } catch (err) {
    return pageFailed({ error: describeFetchError(err) });
  }
  if (!isExpectedStatus(page.response.status, null)) {
    return pageFailed({ httpStatus: page.response.status, statusText: page.response.statusText });
  }

  const { links, total } = extractLinks(html, page.url.toString());
  const broken: BrokenLink[] = [];
  let unverified = 0;
  const pageHost = page.url.hostname;
  const sameSite = links.filter((l) => new URL(l.url).hostname === pageHost);
  const external = links.filter((l) => new URL(l.url).hostname !== pageHost);
  async function worker(queue: typeof links) {
    while (queue.length > 0) {
      const link = queue.shift()!;
      // probeLink never throws, but a scan must survive any single odd link.
      const res = await probeLink(link.url).catch(
        (err): LinkResponse => ({ status: null, error: { message: describeFetchError(err) } }),
      );
      const verdict = judgeLink(res);
      if (verdict === "broken") broken.push({ url: link.url, kind: link.kind, text: link.text, reason: reasonFor(res) });
      else if (verdict === "unknown") unverified++;
    }
  }
  await Promise.all([
    ...Array.from({ length: Math.min(SAME_SITE_CONCURRENCY, sameSite.length) }, () => worker(sameSite)),
    ...Array.from({ length: Math.min(EXTERNAL_CONCURRENCY, external.length) }, () => worker(external)),
  ]);

  // Keep page order so the list reads naturally.
  const order = new Map(links.map((l, i) => [l.url, i]));
  broken.sort((a, b) => order.get(a.url)! - order.get(b.url)!);
  Object.assign(metadata, {
    final_url: page.url.toString(),
    links_found: total,
    links_checked: links.length,
    links_unverified: unverified,
    broken_links: broken.slice(0, 25),
  });
  const outcome = evaluateLinks(page.url.toString(), links.length, broken, performance.now() - started, page.response.status);
  return { outcome, metadata };
}

// SSL certificates ----------------------------------------------------------------

const TLS_TIMEOUT_MS = 10_000;

/** Certificate name fields can repeat; show the first. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Opens a TLS connection to the monitor's host (port 443 unless the URL says
 * otherwise) and reads the certificate. Uses the same SSRF-safe DNS lookup.
 * Doesn't send an HTTP request.
 */
export async function performCertificateCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  const observe = (partial: Partial<CertificateObservation>): CertificateObservation => ({
    validTo: null,
    authorized: false,
    authorizationError: null,
    responseTimeMs: performance.now() - started,
    error: null,
    ...partial,
  });

  let url: URL;
  try {
    url = validateTargetUrl(monitor.target_url);
  } catch (err) {
    return { outcome: evaluateCertificate(observe({ error: describeFetchError(err) })), metadata };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.protocol === "https:" && url.port ? Number(url.port) : 443;

  const observation = await new Promise<CertificateObservation>((resolve) => {
    const socket = connectTls({
      host,
      port,
      servername: isIP(host) ? undefined : host,
      lookup: safeLookup,
      // Read the certificate even when it's invalid, so we can say why.
      rejectUnauthorized: false,
      timeout: TLS_TIMEOUT_MS,
    });
    const finish = (obs: CertificateObservation) => {
      socket.destroy();
      resolve(obs);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return finish(observe({ error: "No certificate received" }));
      metadata.valid_to = new Date(cert.valid_to).toISOString();
      metadata.issuer = first(cert.issuer?.O) ?? first(cert.issuer?.CN) ?? null;
      metadata.subject = first(cert.subject?.CN) ?? null;
      const authError = socket.authorizationError;
      finish(
        observe({
          validTo: new Date(cert.valid_to),
          authorized: socket.authorized,
          authorizationError: authError ? String((authError as Error & { code?: string }).code ?? authError) : null,
        }),
      );
    });
    socket.once("timeout", () => finish(observe({ error: `Timed out after ${TLS_TIMEOUT_MS / 1000} s` })));
    socket.once("error", (err) => finish(observe({ error: describeFetchError(err) })));
  });

  const outcome = evaluateCertificate(observation);
  if (observation.validTo) metadata.days_left = daysUntil(observation.validTo, new Date());
  return { outcome, metadata };
}

// Tracking tags ---------------------------------------------------------------------

/** Loads a page and returns the tracking tags in its HTML (with IDs). */
export async function detectTrackingOnPage(
  target: string,
): Promise<{ found: Partial<Record<TrackingTag, string[]>>; status: number; finalUrl: string; responseTimeMs: number }> {
  const started = performance.now();
  const { response, url } = await safeFetch(validateTargetUrl(target), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = (await readBody(response)).text;
  return {
    found: isExpectedStatus(response.status, null) ? detectTags(html) : {},
    status: response.status,
    finalUrl: url.toString(),
    responseTimeMs: performance.now() - started,
  };
}

export async function performTrackingCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  let page: Awaited<ReturnType<typeof detectTrackingOnPage>>;
  try {
    page = await detectTrackingOnPage(monitor.target_url);
  } catch (err) {
    const outcome = evaluateCheck(monitor, {
      httpStatus: null,
      statusText: "",
      responseTimeMs: performance.now() - started,
      body: null,
      error: describeFetchError(err),
    });
    return { outcome, metadata };
  }
  // The page itself must load before its tags mean anything.
  if (!isExpectedStatus(page.status, null)) {
    const outcome = evaluateCheck(monitor, {
      httpStatus: page.status,
      statusText: "",
      responseTimeMs: page.responseTimeMs,
      body: null,
      error: null,
    });
    return { outcome, metadata };
  }
  const expected = monitor.expected_tags.filter(isTrackingTag);
  Object.assign(metadata, { final_url: page.finalUrl, tags_found: page.found, tags_expected: expected });
  return { outcome: evaluateTags(expected, page.found, page.responseTimeMs, page.status), metadata };
}

// WordPress health ------------------------------------------------------------------

const WPORG_TIMEOUT_MS = 8_000;
const CORE_TTL_MS = 60 * 60_000;
const PLUGIN_TTL_MS = 6 * 60 * 60_000;
const MAX_PLUGIN_LOOKUPS = 15;

let coreCache: { at: number; version: string | null } | null = null;
const pluginCache = new Map<string, { at: number; version: string | null }>();

/** Latest WordPress release from wordpress.org (cached for an hour). */
async function latestCoreVersion(): Promise<string | null> {
  if (coreCache && Date.now() - coreCache.at < CORE_TTL_MS) return coreCache.version;
  let version: string | null = null;
  try {
    const res = await fetch("https://api.wordpress.org/core/version-check/1.7/", {
      signal: AbortSignal.timeout(WPORG_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT },
    });
    const body = (await res.json()) as { offers?: { current?: string }[] };
    version = body.offers?.[0]?.current ?? null;
  } catch {
    // wordpress.org unreachable: skip the core comparison this time.
  }
  coreCache = { at: Date.now(), version };
  return version;
}

/** Latest version of a wordpress.org plugin; null for premium/unknown plugins. Cached 6 hours. */
async function latestPluginVersion(slug: string): Promise<string | null> {
  const hit = pluginCache.get(slug);
  if (hit && Date.now() - hit.at < PLUGIN_TTL_MS) return hit.version;
  let version: string | null = null;
  try {
    const url = `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=${encodeURIComponent(slug)}&request%5Bfields%5D%5Bsections%5D=0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(WPORG_TIMEOUT_MS), headers: { "user-agent": USER_AGENT } });
    const body = (await res.json()) as { version?: string; error?: string };
    version = body.error ? null : (body.version ?? null);
  } catch {
    version = null;
  }
  pluginCache.set(slug, { at: Date.now(), version });
  return version;
}

/** Fetches a same-site URL (SSRF-safe) and returns its text, or null on any problem. */
async function fetchOptionalText(url: string): Promise<string | null> {
  try {
    const { response } = await safeFetch(validateTargetUrl(url), { signal: AbortSignal.timeout(TIMEOUT_MS), accept: "*/*" });
    if (!isExpectedStatus(response.status, null)) {
      await response.body?.cancel();
      return null;
    }
    return (await readBody(response)).text;
  } catch {
    return null;
  }
}

/**
 * Asks the Website Watch Health plugin on this origin for its report. The
 * request is signed for this host only, and redirects aren't followed.
 */
async function fetchPluginReport(origin: string, key: KeyObject): Promise<{ report: PluginReport | null; note: string }> {
  try {
    const { response } = await safeFetch(validateTargetUrl(origin + WP_PLUGIN_ROUTE), {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      followRedirects: false,
      accept: "application/json",
      headers: signRequest(key, new URL(origin).hostname),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return {
        report: null,
        note: "The Website Watch plugin rejected the request: re-install it from Settings if the key changed, or check the site's clock",
      };
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { report: null, note: "The plugin request was redirected, so the report was skipped" };
    }
    const body = await readBody(response);
    let report: PluginReport | null = null;
    try {
      report = response.ok ? parsePluginReport(JSON.parse(body.text)) : null;
    } catch {
      report = null;
    }
    if (report) return { report, note: "Reported by the Website Watch plugin" };
    return {
      report: null,
      note:
        response.status === 404 || response.ok
          ? "Website Watch plugin not installed or not active"
          : `Plugin report failed (HTTP ${response.status})`,
    };
  } catch (err) {
    return { report: null, note: `Couldn't reach the Website Watch plugin: ${describeFetchError(err)}` };
  }
}

/**
 * WordPress version, plugins and theme from public signals, compared with
 * wordpress.org; plus WP Engine install details and backups when the WP Engine
 * API is configured and an install matches the site's domain.
 */
export async function performWordPressCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  const pageFailed = (partial: Partial<HttpObservation>): HttpCheckResult => ({
    outcome: evaluateCheck(monitor, {
      httpStatus: null,
      statusText: "",
      responseTimeMs: performance.now() - started,
      body: null,
      error: null,
      ...partial,
    }),
    metadata,
  });

  let page: { response: Response; url: URL };
  let html: string;
  try {
    page = await safeFetch(validateTargetUrl(monitor.target_url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    html = (await readBody(page.response)).text;
  } catch (err) {
    return pageFailed({ error: describeFetchError(err) });
  }
  if (!isExpectedStatus(page.response.status, null)) {
    return pageFailed({ httpStatus: page.response.status, statusText: page.response.statusText });
  }

  const origin = page.url.origin;
  const signingKey = pluginKey();
  const [feed, restIndex, latestCore, pluginResult] = await Promise.all([
    fetchOptionalText(`${origin}/feed/`),
    fetchOptionalText(`${origin}/wp-json/`),
    latestCoreVersion(),
    signingKey ? fetchPluginReport(origin, signingKey) : null,
  ]);
  const report = pluginResult?.report ?? null;
  let namespaces: string[] | null = null;
  try {
    const parsed = restIndex ? (JSON.parse(restIndex) as { namespaces?: unknown }) : null;
    namespaces = Array.isArray(parsed?.namespaces) ? parsed.namespaces.filter((n): n is string => typeof n === "string") : null;
  } catch {
    namespaces = null;
  }
  const signals = detectWordPress(html, feed, namespaces);

  // WP Engine: install details and backups for the install serving this domain.
  let install: WpeInstall | null = null;
  let backups: BackupStatus | null = null;
  let wpengineError: string | null = null;
  if (isWpeConfigured()) {
    try {
      const installs = await listInstalls();
      install = matchInstall(installs, page.url.hostname) ?? matchInstall(installs, new URL(monitor.target_url).hostname);
      if (install) backups = summarizeBackups(await listBackups(install.id));
    } catch (err) {
      wpengineError = err instanceof Error ? err.message : "WP Engine API request failed";
    }
  }

  // The plugin knows every plugin and its update (premium included). Without it,
  // compare plugins whose version the page reveals with wordpress.org.
  let plugins: { slug: string; name?: string; version: string | null; latest: string | null; source: string; active?: boolean }[];
  if (report) {
    plugins = report.plugins.map((p) => ({
      slug: p.id.split("/")[0].replace(/.php$/, ""),
      name: p.name,
      version: p.version,
      latest: p.update,
      source: "plugin",
      active: p.active,
    }));
  } else {
    const versioned = signals.plugins.filter((p) => p.version).slice(0, MAX_PLUGIN_LOOKUPS);
    const latestBySlug = new Map(
      await Promise.all(versioned.map(async (p) => [p.slug, await latestPluginVersion(p.slug)] as const)),
    );
    plugins = signals.plugins.map((p) => ({ ...p, latest: latestBySlug.get(p.slug) ?? null }));
  }
  // The plugin reports WordPress's own update offers; public versions are compared.
  const outdatedPlugins = plugins
    .filter((p) => p.version && p.latest && (report ? true : compareVersions(p.version, p.latest) < 0))
    .map((p) => ({ slug: p.slug, version: p.version!, latest: p.latest! }));

  const wpeVersion = install?.wp_version ?? backups?.wordpressVersion ?? null;
  const facts: WordPressFacts = {
    wpVersion: report?.wordpress.version ?? wpeVersion ?? signals.version,
    latestWpVersion: latestCore,
    phpVersion: report?.php.version ?? install?.php_version ?? null,
    install,
    backups,
    outdatedPlugins,
    isWordPress: signals.isWordPress,
    report,
  };
  const problems = wordpressProblems(facts, new Date());

  Object.assign(metadata, {
    final_url: page.url.toString(),
    wordpress: {
      version: facts.wpVersion,
      latest: latestCore,
      source: report?.wordpress.version ? "plugin" : wpeVersion ? "wpengine" : signals.versionSource,
    },
    php_version: facts.phpVersion,
    themes: report ? report.themes.filter((t) => t.active).map((t) => t.id) : signals.themes,
    plugins,
    wpengine: install
      ? {
          install: install.name,
          environment: install.environment,
          status: install.status,
          last_backup_at: backups?.lastCompletedAt ?? null,
          latest_backup_status: backups?.latestStatus ?? null,
          upgrades_deferred_until: install.defer_wordpress_upgrades_until,
        }
      : null,
    plugin_report: report
      ? {
          plugin_version: report.pluginVersion,
          generated_at: report.generatedAt,
          updates_checked_at: report.pluginsCheckedAt,
          memory_limit: report.php.memoryLimit,
          debug_display: report.debugDisplay,
          cron_overdue_minutes: report.cron.overdueMinutes,
          themes: report.themes.map((t) => ({ slug: t.id, name: t.name, version: t.version, latest: t.update, active: t.active })),
          // null: the site's plugin is older than 1.2 and doesn't record PHP errors.
          fatal_errors:
            report.fatalErrors?.map((e) => ({
              first_at: e.firstAt,
              last_at: e.lastAt,
              count: e.count,
              message: e.message,
              file: e.file,
              line: e.line,
              source: fatalErrorSourceName(e.file, report),
            })) ?? null,
        }
      : null,
    plugin_note: pluginResult?.note ?? null,
    wpengine_note: wpengineError ?? (isWpeConfigured() ? (install ? null : "No WP Engine install matches this domain") : "WP Engine API not configured"),
    problems,
  });
  return { outcome: evaluateWordPress(problems, performance.now() - started, page.response.status), metadata };
}

/** Runs the right kind of check for the monitor. */
export function performCheck(monitor: Monitor): Promise<HttpCheckResult> {
  if (monitor.monitor_type === "ssl_expiry") return performCertificateCheck(monitor);
  if (monitor.monitor_type === "broken_links") return performBrokenLinksCheck(monitor);
  if (monitor.monitor_type === "tracking_tags") return performTrackingCheck(monitor);
  if (monitor.monitor_type === "wordpress_health") return performWordPressCheck(monitor);
  return performHttpCheck(monitor);
}
