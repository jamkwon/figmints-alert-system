// Performs one HTTP check for a monitor. Never throws: failures become a failed outcome.
import { isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { Agent, fetch, type Response } from "undici";
import type { Monitor } from "../types.ts";
import {
  daysUntil,
  evaluateCertificate,
  evaluateCheck,
  type CertificateObservation,
  type CheckOutcome,
  type HttpObservation,
} from "./evaluate.ts";
import { UnsafeUrlError, safeLookup, validateTargetUrl } from "./url-safety.ts";

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
    let url = validateTargetUrl(monitor.target_url);
    // A monitor expecting a 3xx is checking the redirect itself, so don't follow it.
    const expected = monitor.expected_status_code;
    const followRedirects = !(expected !== null && expected >= 300 && expected < 400);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let redirects = 0;
    let response: Response;

    while (true) {
      response = await fetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (!followRedirects || !isRedirect) break;
      await response.body?.cancel();
      if (redirects >= MAX_REDIRECTS) {
        return { outcome: evaluateCheck(monitor, observe({ error: "Too many redirects" })), metadata };
      }
      url = validateTargetUrl(new URL(location, url).toString());
      redirects++;
    }

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

/** Runs the right kind of check for the monitor. */
export function performCheck(monitor: Monitor): Promise<HttpCheckResult> {
  return monitor.monitor_type === "ssl_expiry" ? performCertificateCheck(monitor) : performHttpCheck(monitor);
}
