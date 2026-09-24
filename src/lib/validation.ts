// Parsing and validation for the manage forms. Pure (relative imports only) so it
// can be tested directly. Every URL goes through the same SSRF rules as the checks.
import { UnsafeUrlError, validateTargetUrl } from "./monitoring/url-safety.ts";
import { ENVIRONMENTS, INTERVALS, MONITOR_TYPES, SEVERITIES } from "./labels.ts";

export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const MAX_NAME = 120;
const MAX_TEXT = 500;
const MAX_NOTES = 5000;

function str(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseName(value: FormDataEntryValue | null | undefined, field = "name", label = "Name"): string {
  const name = str(value);
  if (!name) throw new ValidationError(field, `${label} is required.`);
  if (name.length > MAX_NAME) throw new ValidationError(field, `${label} must be ${MAX_NAME} characters or fewer.`);
  return name;
}

export function parseNotes(value: FormDataEntryValue | null | undefined, field = "notes"): string {
  const notes = str(value).replace(/\r\n/g, "\n");
  if (notes.length > MAX_NOTES) throw new ValidationError(field, `Notes must be ${MAX_NOTES} characters or fewer.`);
  return notes;
}

/** Public http(s) URL, normalized. Adds https:// when the scheme is missing. */
export function parseUrl(value: FormDataEntryValue | null | undefined, field = "url", required = true): string | null {
  let raw = str(value);
  if (!raw) {
    if (required) throw new ValidationError(field, "URL is required.");
    return null;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    return validateTargetUrl(raw).toString();
  } catch (err) {
    throw new ValidationError(field, err instanceof UnsafeUrlError ? err.message : "Not a valid URL.");
  }
}

/** A monitor target: a full URL, or a path like "/contact" relative to the website. */
export function resolveMonitorUrl(websiteUrl: string, input: string, field = "target_url"): string {
  const value = input.trim();
  if (!value) throw new ValidationError(field, "URL or path is required.");
  if (value.startsWith("/")) {
    const base = new URL(websiteUrl);
    return parseUrl(new URL(value, base.origin).toString(), field)!;
  }
  return parseUrl(value, field)!;
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], field: string, label: string): T {
  const match = allowed.find((a) => String(a) === String(value));
  if (match === undefined) throw new ValidationError(field, `Choose a valid ${label}.`);
  return match;
}

export const parseInterval = (v: unknown) => oneOf(v, INTERVALS, "interval_minutes", "interval");
export const parseMonitorType = (v: unknown) => oneOf(v, MONITOR_TYPES, "monitor_type", "monitor type");
export const parseSeverity = (v: unknown) => oneOf(v, SEVERITIES, "severity_on_failure", "severity");
export const parseEnvironment = (v: unknown) => oneOf(v, ENVIRONMENTS, "environment", "environment");

export function parseOptionalInt(
  value: FormDataEntryValue | null | undefined,
  field: string,
  label: string,
  min: number,
  max: number,
): number | null {
  const raw = str(value);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(field, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export function parseExpectedText(value: FormDataEntryValue | null | undefined, field = "expected_text"): string | null {
  const text = str(value);
  if (!text) return null;
  if (text.length > MAX_TEXT) throw new ValidationError(field, `Expected text must be ${MAX_TEXT} characters or fewer.`);
  return text;
}

export function parseCheckbox(value: FormDataEntryValue | null | undefined): boolean {
  return value === "on" || value === "true";
}

export interface BulkMonitorLine {
  name: string;
  target_url: string;
  expected_text: string | null;
}

/**
 * Quick monitor setup, one page per line: "/contact" or "/contact | Contact Us" or
 * "https://other.example/page". A line with text after "|" becomes an Expected
 * Content monitor. Names come from the path ("/free-estimate" → "Free Estimate").
 */
export function parseBulkLines(websiteUrl: string, text: string, field = "pages"): BulkMonitorLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 25) throw new ValidationError(field, "Add at most 25 pages at a time.");
  const seen = new Set<string>();
  return lines.map((line, i) => {
    const [target, ...rest] = line.split("|");
    let url: string;
    try {
      url = resolveMonitorUrl(websiteUrl, target, field);
    } catch (err) {
      throw new ValidationError(field, `Line ${i + 1}: ${err instanceof Error ? err.message : "invalid"}`);
    }
    if (seen.has(url)) throw new ValidationError(field, `Line ${i + 1}: ${url} is listed twice.`);
    seen.add(url);
    const expected = rest.join("|").trim();
    return { name: nameFromUrl(url), target_url: url, expected_text: expected ? expected.slice(0, MAX_TEXT) : null };
  });
}

/** "/free-estimate/" → "Free Estimate Page"; "/" → "Homepage". */
export function nameFromUrl(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (!path) return "Homepage";
  const last = decodeURIComponent(path.split("/").pop() ?? "");
  const words = last.replace(/\.[a-z0-9]+$/i, "").split(/[-_\s]+/).filter(Boolean);
  const title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return title ? `${title} Page`.slice(0, MAX_NAME) : "Page";
}
