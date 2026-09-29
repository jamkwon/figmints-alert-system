// Performs one HTTP check for a monitor. Never throws: failures become a failed outcome.
import type { KeyObject } from "node:crypto";
import { isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { Agent, fetch, type Response } from "undici";
import { DEFAULT_SETTINGS, type AppSettings } from "../settings.ts";
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
import { RDAP_BOOTSTRAP_URL, daysLeft, domainCandidates, evaluateDomain, parseRdap, rdapBaseFor } from "./domain.ts";
import { evaluateVisibility, findNoindex, foreignCanonical, robotsBlocks } from "./visibility.ts";
import { PAGESPEED_API, PAGESPEED_STRATEGY, evaluatePageSpeed, parsePageSpeed, scoreBaseline } from "./pagespeed.ts";
import { detectForms, evaluateForms, hubspotDefinitionUrl, hubspotFormStatus } from "./forms.ts";
import { firstSetEnv } from "../supabase/config.ts";
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

// The WordPress plugin's report can't be cached (it's a signed POST), so it
// always pays WordPress's full start-up time, which is slow on some sites
// (13 s+ on some WP Engine staging installs). Give it more room; contact form
// pages, often left uncached, get the same.
const PLUGIN_TIMEOUT_MS = 20_000;
const pluginAgent = new Agent({
  connect: { lookup: safeLookup, timeout: 10_000 },
  headersTimeout: PLUGIN_TIMEOUT_MS,
  bodyTimeout: PLUGIN_TIMEOUT_MS,
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
export function describeFetchError(err: unknown, timeoutMs = TIMEOUT_MS): string {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const e = current as ErrorWithCode;
    if (e instanceof UnsafeUrlError) return e.message;
    if (e.name === "TimeoutError" || e.name === "AbortError") return `Timed out after ${timeoutMs / 1000} s`;
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
        return `Timed out after ${timeoutMs / 1000} s`;
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
    /** Connection pool with different timeouts (it must use safeLookup too). */
    dispatcher?: Agent;
  },
): Promise<{ response: Response; url: URL; redirects: number }> {
  let url = start;
  let redirects = 0;
  while (true) {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      dispatcher: options.dispatcher ?? agent,
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
export async function performCertificateCheck(monitor: Monitor, settings: AppSettings = DEFAULT_SETTINGS): Promise<HttpCheckResult> {
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
    return { outcome: evaluateCertificate(observe({ error: describeFetchError(err) }), new Date(), settings), metadata };
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

  const outcome = evaluateCertificate(observation, new Date(), settings);
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

// Checks of the same site in one run (WordPress Health, Contact Form) share one
// report: signatures cover the site and the second, and the plugin accepts each
// only once, so two requests in the same second would have the second refused.
const REPORT_SHARE_MS = 60_000;
const sharedReports = new Map<string, { at: number; result: Promise<{ report: PluginReport | null; note: string }> }>();

function pluginReportFor(origin: string, key: KeyObject): Promise<{ report: PluginReport | null; note: string }> {
  const now = Date.now();
  for (const [o, entry] of sharedReports) if (now - entry.at > REPORT_SHARE_MS) sharedReports.delete(o);
  const hit = sharedReports.get(origin);
  if (hit) return hit.result;
  const result = fetchPluginReport(origin, key);
  sharedReports.set(origin, { at: now, result });
  return result;
}

/**
 * Asks the Website Watch Health plugin on this origin for its report. The
 * request is signed for this host only, and redirects aren't followed.
 */
async function fetchPluginReport(origin: string, key: KeyObject): Promise<{ report: PluginReport | null; note: string }> {
  try {
    const { response } = await safeFetch(validateTargetUrl(origin + WP_PLUGIN_ROUTE), {
      method: "POST",
      signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS),
      dispatcher: pluginAgent,
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
    return { report: null, note: `Couldn't reach the Website Watch plugin: ${describeFetchError(err, PLUGIN_TIMEOUT_MS)}` };
  }
}

/**
 * WordPress version, plugins and theme from public signals, compared with
 * wordpress.org; plus WP Engine install details and backups when the WP Engine
 * API is configured and an install matches the site's domain.
 */
export async function performWordPressCheck(monitor: Monitor, settings: AppSettings = DEFAULT_SETTINGS): Promise<HttpCheckResult> {
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
  const finalHost = page.url.hostname;

  // WP Engine: install details and backups for the install serving this domain.
  async function lookupWpEngine(): Promise<{ install: WpeInstall | null; backups: BackupStatus | null; error: string | null }> {
    if (!isWpeConfigured()) return { install: null, backups: null, error: null };
    try {
      const installs = await listInstalls();
      const install = matchInstall(installs, finalHost) ?? matchInstall(installs, new URL(monitor.target_url).hostname);
      return { install, backups: install ? summarizeBackups(await listBackups(install.id)) : null, error: null };
    } catch (err) {
      return { install: null, backups: null, error: err instanceof Error ? err.message : "WP Engine API request failed" };
    }
  }

  // All at once, so a slow site and a slow API don't add up.
  const [feed, restIndex, latestCore, pluginResult, wpe] = await Promise.all([
    fetchOptionalText(`${origin}/feed/`),
    fetchOptionalText(`${origin}/wp-json/`),
    latestCoreVersion(),
    signingKey ? pluginReportFor(origin, signingKey) : null,
    lookupWpEngine(),
  ]);
  const { install, backups, error: wpengineError } = wpe;
  const report = pluginResult?.report ?? null;
  let namespaces: string[] | null = null;
  try {
    const parsed = restIndex ? (JSON.parse(restIndex) as { namespaces?: unknown }) : null;
    namespaces = Array.isArray(parsed?.namespaces) ? parsed.namespaces.filter((n): n is string => typeof n === "string") : null;
  } catch {
    namespaces = null;
  }
  const signals = detectWordPress(html, feed, namespaces);

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
  const problems = wordpressProblems(facts, new Date(), settings);

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

// Search visibility -------------------------------------------------------------------

async function fetchRobots(origin: string): Promise<{ status: number | null; text: string | null }> {
  try {
    const { response } = await safeFetch(validateTargetUrl(`${origin}/robots.txt`), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      accept: "text/plain,*/*;q=0.8",
    });
    if (response.status >= 400) {
      await response.body?.cancel();
      return { status: response.status, text: null };
    }
    return { status: response.status, text: (await readBody(response)).text };
  } catch {
    return { status: null, text: null };
  }
}

/** Is the page open to search engines: no noindex, not blocked by robots.txt, canonical on this domain. */
export async function performVisibilityCheck(monitor: Monitor): Promise<HttpCheckResult> {
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
  const elapsed = performance.now() - started;
  if (!isExpectedStatus(page.response.status, null)) {
    return pageFailed({ httpStatus: page.response.status, statusText: page.response.statusText, responseTimeMs: elapsed });
  }
  const robots = await fetchRobots(page.url.origin);
  const findings = {
    noindex: findNoindex(html, page.response.headers.get("x-robots-tag")),
    robots: { status: robots.status, blocks: robots.text !== null && robotsBlocks(robots.text, page.url.pathname) },
    foreignCanonical: foreignCanonical(html, page.url),
  };
  Object.assign(metadata, {
    final_url: page.url.toString(),
    noindex: findings.noindex,
    robots_status: robots.status,
    robots_blocks: findings.robots.blocks,
    foreign_canonical: findings.foreignCanonical,
  });
  return { outcome: evaluateVisibility(findings, elapsed, page.response.status), metadata };
}

// Domain expiry -----------------------------------------------------------------------

const RDAP_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TTL_MS = 24 * 3_600_000;
let bootstrapCache: { at: number; body: unknown } | null = null;

/** IANA's list of RDAP servers per TLD (cached for a day). */
async function rdapBootstrap(): Promise<unknown> {
  if (bootstrapCache && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS) return bootstrapCache.body;
  const res = await fetch(RDAP_BOOTSTRAP_URL, {
    signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`IANA's RDAP list answered HTTP ${res.status}`);
  const body: unknown = await res.json();
  bootstrapCache = { at: Date.now(), body };
  return body;
}

/** When the site's domain registration expires, from the registry's RDAP service. */
export async function performDomainCheck(monitor: Monitor): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  const warn = (message: string): HttpCheckResult => ({
    outcome: {
      http_status: null,
      response_time_ms: Math.round(performance.now() - started),
      status: "warning",
      passed: false,
      error_message: message,
    },
    metadata,
  });
  const candidates = domainCandidates(new URL(monitor.target_url).hostname);
  if (candidates.length === 0) return warn("No domain name to look up");
  let bootstrap: unknown;
  try {
    bootstrap = await rdapBootstrap();
  } catch (err) {
    return warn(`Couldn't load the list of domain registries: ${err instanceof Error ? err.message : "request failed"}`);
  }
  for (const domain of candidates) {
    const base = rdapBaseFor(domain, bootstrap);
    if (!base) return warn(`Expiry lookup isn't available for .${domain.split(".").at(-1)} domains`);
    let response: Response;
    try {
      // The registry's address comes from IANA; safeFetch still refuses private addresses and re-checks redirects.
      ({ response } = await safeFetch(validateTargetUrl(`${base}domain/${encodeURIComponent(domain)}`), {
        signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
        accept: "application/rdap+json, application/json",
      }));
    } catch (err) {
      return warn(`Couldn't reach the domain registry: ${describeFetchError(err, RDAP_TIMEOUT_MS)}`);
    }
    if (response.status === 404) {
      await response.body?.cancel();
      continue; // Not a registered name at this level (e.g. "co.uk"); try the next.
    }
    if (!response.ok) {
      await response.body?.cancel();
      return warn(`The domain registry answered HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = JSON.parse((await readBody(response)).text);
    } catch {
      return warn("The domain registry's answer couldn't be read");
    }
    const info = parseRdap(domain, body);
    // "co.uk" and similar exist in their registry but aren't registrations: try the longer name.
    if (!info.expiresAt && domain !== candidates.at(-1)) continue;
    Object.assign(metadata, {
      domain,
      expires_at: info.expiresAt,
      days_left: info.expiresAt ? daysLeft(info.expiresAt, new Date()) : null,
      registrar: info.registrar,
      statuses: info.statuses,
      rdap_server: new URL(base).hostname,
    });
    return { outcome: evaluateDomain(info, new Date(), performance.now() - started), metadata };
  }
  return warn(`The registry doesn't know ${candidates.join(" or ")}`);
}

// Page speed ---------------------------------------------------------------------------

/** Lighthouse runs take 10–40 s; the scheduler starts these first so a run still ends within 60 s. */
export const PAGESPEED_TIMEOUT_MS = 45_000;

function pagespeedKey(): string | null {
  return firstSetEnv(["PAGESPEED_API_KEY"])?.value?.trim() || null;
}

export function isPageSpeedConfigured(): boolean {
  return pagespeedKey() !== null;
}

/** Google PageSpeed Insights for the page (mobile): Lighthouse score, lab and real-user metrics. */
export async function performPageSpeedCheck(
  monitor: Monitor,
  settings: AppSettings = DEFAULT_SETTINGS,
  /** Scores from the previous 7 days, to spot a sharp drop. */
  previousScores: number[] = [],
): Promise<HttpCheckResult> {
  const started = performance.now();
  const metadata: CheckMetadata = {};
  const warn = (message: string): HttpCheckResult => ({
    outcome: {
      http_status: null,
      response_time_ms: Math.round(performance.now() - started),
      status: "warning",
      passed: false,
      error_message: message,
    },
    metadata,
  });
  const key = pagespeedKey();
  if (!key) return warn("PAGESPEED_API_KEY isn't set (see README → Page speed)");
  let target: URL;
  try {
    target = validateTargetUrl(monitor.target_url);
  } catch (err) {
    return warn(err instanceof Error ? err.message : "Not a valid URL");
  }
  const query = new URLSearchParams({ url: target.toString(), strategy: PAGESPEED_STRATEGY, category: "performance", key });
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    // A fixed Google host; the key stays out of any message or stored result.
    res = await fetch(`${PAGESPEED_API}?${query}`, {
      signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    return warn(`PageSpeed didn't answer: ${describeFetchError(err, PAGESPEED_TIMEOUT_MS)}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return warn(`PageSpeed answered HTTP ${res.status} with no readable result`);
  }
  if (!res.ok) {
    const error = (body as { error?: { message?: unknown } })?.error;
    const message = typeof error?.message === "string" ? error.message.replace(/key=[^&\s]+/gi, "key=…").slice(0, 200) : "";
    if (res.status === 429) return warn("PageSpeed's daily quota is used up; the next check will try again");
    if (res.status === 400 || res.status === 403) return warn(`PageSpeed refused the request: ${message || `HTTP ${res.status}`}`);
    return warn(`PageSpeed answered HTTP ${res.status}${message ? `: ${message}` : ""}`);
  }
  const result = parsePageSpeed(body);
  Object.assign(metadata, {
    final_url: result.finalUrl,
    strategy: PAGESPEED_STRATEGY,
    score: result.score,
    lab: result.lab,
    field: result.field,
    opportunities: result.opportunities,
    lighthouse_version: result.lighthouseVersion,
  });
  const baseline = scoreBaseline(previousScores);
  metadata.baseline = baseline;
  return { outcome: evaluatePageSpeed(result, settings.minPerformanceScore, performance.now() - started, baseline), metadata };
}

// Contact form ---------------------------------------------------------------------------

/**
 * Is there a usable form on the page (any builder), and, with the Website Watch
 * plugin, does the site's email work? Never submits anything.
 */
export async function performContactFormCheck(monitor: Monitor): Promise<HttpCheckResult> {
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
  // Ask the site plugin while the page loads: both can be slow on uncached pages
  // (form pages often are), and one after the other could outlast a scheduler run.
  const signingKey = pluginKey();
  const targetOrigin = new URL(monitor.target_url).origin;
  const earlyPlugin = signingKey ? pluginReportFor(targetOrigin, signingKey) : null;
  let page: { response: Response; url: URL };
  let html: string;
  try {
    page = await safeFetch(validateTargetUrl(monitor.target_url), {
      signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS),
      dispatcher: pluginAgent,
    });
    html = (await readBody(page.response)).text;
  } catch (err) {
    return pageFailed({ error: describeFetchError(err, PLUGIN_TIMEOUT_MS) });
  }
  const elapsed = performance.now() - started;
  if (!isExpectedStatus(page.response.status, null)) {
    return pageFailed({ httpStatus: page.response.status, statusText: page.response.statusText, responseTimeMs: elapsed });
  }
  const findings = detectForms(html);
  const scriptUrl = findings.embeds.find((e) => e.scriptUrl)?.scriptUrl ?? null;
  const hubspotChecks = findings.embeds.flatMap((e) => {
    const url = hubspotDefinitionUrl(e);
    return url && e.id ? [{ id: e.id, url }] : [];
  }).slice(0, 3);
  const [embedScriptOk, plugin, hubspot] = await Promise.all([
    scriptUrl
      ? safeFetch(validateTargetUrl(scriptUrl), { signal: AbortSignal.timeout(TIMEOUT_MS), accept: "*/*" })
          .then(async ({ response }) => {
            await response.body?.cancel();
            return response.ok;
          })
          .catch(() => false)
      : null,
    // The plugin signs for one host: if the page redirected elsewhere (e.g. to www.), ask there.
    signingKey && page.url.origin !== targetOrigin ? pluginReportFor(page.url.origin, signingKey) : earlyPlugin,
    Promise.all(
      hubspotChecks.map(async ({ id, url }) => {
        try {
          const { response } = await safeFetch(validateTargetUrl(url), { signal: AbortSignal.timeout(TIMEOUT_MS), accept: "application/json" });
          if (response.status !== 200) {
            await response.body?.cancel();
            return hubspotFormStatus(id, response.status, null);
          }
          return hubspotFormStatus(id, 200, JSON.parse((await readBody(response)).text));
        } catch {
          return hubspotFormStatus(id, null, null);
        }
      }),
    ),
  ]);
  const mail = plugin?.report?.mail ?? null;
  Object.assign(metadata, {
    final_url: page.url.toString(),
    forms: findings.forms,
    embeds: findings.embeds,
    form_errors: findings.errors,
    captcha: findings.captcha,
    embed_script_ok: embedScriptOk,
    hubspot_forms: hubspot,
    mail,
    plugin_note: plugin
      ? plugin.report && !plugin.report.mail
        ? "Update the Website Watch plugin to 1.3 to check the site's email"
        : plugin.note
      : null,
  });
  return {
    outcome: evaluateForms({ findings, embedScriptOk, hubspot, mail, now: new Date() }, elapsed, page.response.status),
    metadata,
  };
}

/** Recent results some checks compare against. */
export interface CheckContext {
  /** Page speed: scores from the previous 7 days. */
  previousScores?: number[];
}

/** Runs the right kind of check for the monitor, with the rules from Settings. */
export function performCheck(
  monitor: Monitor,
  settings: AppSettings = DEFAULT_SETTINGS,
  context: CheckContext = {},
): Promise<HttpCheckResult> {
  // Monitors without their own response time limit use the Settings default.
  const m = { ...monitor, max_response_time_ms: monitor.max_response_time_ms ?? settings.defaultMaxResponseMs };
  if (m.monitor_type === "ssl_expiry") return performCertificateCheck(m, settings);
  if (m.monitor_type === "broken_links") return performBrokenLinksCheck(m);
  if (m.monitor_type === "tracking_tags") return performTrackingCheck(m);
  if (m.monitor_type === "wordpress_health") return performWordPressCheck(m, settings);
  if (m.monitor_type === "search_visibility") return performVisibilityCheck(m);
  if (m.monitor_type === "domain_expiry") return performDomainCheck(m);
  if (m.monitor_type === "page_speed") return performPageSpeedCheck(m, settings, context.previousScores);
  if (m.monitor_type === "contact_form") return performContactFormCheck(m);
  return performHttpCheck(m);
}
