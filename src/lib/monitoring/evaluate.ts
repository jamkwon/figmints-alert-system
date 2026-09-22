// Pure pass/fail rules for a single check. No I/O, so it's easy to test.
import type { CheckStatus, Monitor } from "../types.ts";

export const DEFAULT_MAX_RESPONSE_TIME_MS = 3000;

/** What the HTTP request observed. `error` is set when no usable response arrived. */
export interface HttpObservation {
  httpStatus: number | null;
  statusText: string;
  responseTimeMs: number;
  body: string | null;
  error: string | null;
}

export interface CheckOutcome {
  status: CheckStatus;
  passed: boolean;
  http_status: number | null;
  response_time_ms: number;
  error_message: string | null;
}

export type MonitorRules = Pick<
  Monitor,
  "monitor_type" | "expected_status_code" | "expected_text" | "max_response_time_ms"
>;

/** Default success is HTTP 200–399 unless the monitor expects a specific code. */
export function isExpectedStatus(status: number, expected: number | null): boolean {
  if (expected !== null) return status === expected;
  return status >= 200 && status < 400;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
};

function normalizeText(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Case-insensitive match against the page's visible text: tags, scripts and styles
 * are removed and whitespace/entities normalized, so "Contact&nbsp;<b>Us</b>"
 * matches "Contact Us".
 */
export function pageContainsText(html: string, expected: string): boolean {
  const needle = normalizeText(expected);
  if (!needle) return true;
  const visible = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(visible).includes(needle);
}

export function evaluateCheck(monitor: MonitorRules, obs: HttpObservation): CheckOutcome {
  const base = { http_status: obs.httpStatus, response_time_ms: Math.round(obs.responseTimeMs) };
  const fail = (message: string): CheckOutcome => ({
    ...base,
    status: "failed",
    passed: false,
    error_message: message,
  });

  if (obs.error || obs.httpStatus === null) return fail(obs.error ?? "No response");

  if (!isExpectedStatus(obs.httpStatus, monitor.expected_status_code)) {
    const got = `HTTP ${obs.httpStatus}${obs.statusText ? ` ${obs.statusText}` : ""}`;
    return fail(monitor.expected_status_code === null ? got : `Expected HTTP ${monitor.expected_status_code}, got ${got}`);
  }

  if (monitor.expected_text && !pageContainsText(obs.body ?? "", monitor.expected_text)) {
    return fail(`Expected text "${monitor.expected_text}" not found`);
  }

  if (monitor.monitor_type === "response_time") {
    const max = monitor.max_response_time_ms ?? DEFAULT_MAX_RESPONSE_TIME_MS;
    if (base.response_time_ms > max) {
      return {
        ...base,
        status: "warning",
        passed: false,
        error_message: `Response time ${base.response_time_ms} ms exceeds ${max} ms threshold`,
      };
    }
  }

  return { ...base, status: "passed", passed: true, error_message: null };
}
