// Broken link scanning: which links to check and how to judge the answers.
// Pure (relative imports only) so it can be tested directly.
import type { CheckOutcome } from "./evaluate.ts";

/** Most links checked per scan. Same-site links go first. */
export const MAX_LINKS = 40;

export type LinkKind = "link" | "image" | "stylesheet" | "script";

export interface FoundLink {
  url: string;
  kind: LinkKind;
  /** Visible text for <a> links (trimmed), or alt text for images. */
  text: string | null;
}

const TAGS: { pattern: RegExp; kind: LinkKind }[] = [
  { pattern: /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, kind: "link" },
  { pattern: /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi, kind: "image" },
  { pattern: /<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet)[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi, kind: "stylesheet" },
  { pattern: /<script\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi, kind: "script" },
];

function cleanText(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 80) : null;
}

function altText(tag: string): string | null {
  const match = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
  return match ? cleanText(match[2]) : null;
}

/**
 * Links, images, stylesheets and scripts on the page, resolved to absolute
 * http(s) URLs, deduplicated (ignoring #fragments), same-site first, capped.
 * Skips mailto:, tel:, javascript:, data: and in-page anchors.
 */
export function extractLinks(html: string, pageUrl: string, max = MAX_LINKS): { links: FoundLink[]; total: number } {
  const page = new URL(pageUrl);
  // Honor <base href> if present.
  const baseMatch = html.match(/<base\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/i);
  let base = page;
  try {
    if (baseMatch) base = new URL(baseMatch[2], page);
  } catch {
    // Invalid <base>: fall back to the page URL.
  }

  const seen = new Map<string, FoundLink>();
  for (const { pattern, kind } of TAGS) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[2].trim().replace(/&amp;/g, "&");
      if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript|data|sms|ftp):/i.test(raw)) continue;
      let url: URL;
      try {
        url = new URL(raw, base);
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      const key = url.toString();
      if (key === page.toString() || seen.has(key)) continue;
      seen.set(key, { url: key, kind, text: kind === "link" ? cleanText(match[3]) : kind === "image" ? altText(match[0]) : null });
    }
  }

  const all = [...seen.values()];
  const sameSite = all.filter((l) => new URL(l.url).hostname === page.hostname);
  const external = all.filter((l) => new URL(l.url).hostname !== page.hostname);
  return { links: [...sameSite, ...external].slice(0, max), total: all.length };
}

/** What a single link request returned. */
export interface LinkResponse {
  status: number | null;
  /** Network-level failure code/message when there was no response. */
  error: { code?: string; message: string } | null;
}

export type LinkVerdict = "ok" | "broken" | "unknown";

/**
 * Only clear failures count as broken. Many sites block automated checkers
 * (401/403/429, LinkedIn's 999) or are just slow, and those aren't the site's fault.
 */
export function judgeLink(res: LinkResponse): LinkVerdict {
  if (res.status !== null) {
    if (res.status === 404 || res.status === 410) return "broken";
    if (res.status >= 500 && res.status <= 599) return "broken";
    if (res.status >= 200 && res.status < 400) return "ok";
    return "unknown";
  }
  const code = String(res.error?.code ?? "");
  if (code === "ENOTFOUND" || code === "ECONNREFUSED") return "broken";
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code === "DEPTH_ZERO_SELF_SIGNED_CERT") return "broken";
  return "unknown";
}

export interface BrokenLink {
  url: string;
  kind: LinkKind;
  text: string | null;
  /** "404", "500", "DNS not found", ... */
  reason: string;
}

export function reasonFor(res: LinkResponse): string {
  if (res.status !== null) return `HTTP ${res.status}`;
  const code = String(res.error?.code ?? "");
  switch (code) {
    case "ENOTFOUND":
      return "Domain not found";
    case "ECONNREFUSED":
      return "Connection refused";
    default:
      return code.startsWith("CERT_") || code.startsWith("ERR_TLS")
        ? "SSL error"
        : (res.error?.message ?? "Failed");
  }
}

function shortUrl(url: string, pageUrl: string): string {
  const u = new URL(url);
  return u.hostname === new URL(pageUrl).hostname ? u.pathname + u.search : u.hostname + u.pathname;
}

/** Warning when anything is broken; the page itself loading is judged separately. */
export function evaluateLinks(
  pageUrl: string,
  checked: number,
  broken: BrokenLink[],
  responseTimeMs: number,
  pageStatus: number,
): CheckOutcome {
  const base = { http_status: pageStatus, response_time_ms: Math.round(responseTimeMs) };
  if (broken.length === 0) return { ...base, status: "passed", passed: true, error_message: null };
  const listed = broken
    .slice(0, 3)
    .map((b) => `${shortUrl(b.url, pageUrl)} (${b.reason})`)
    .join(", ");
  const more = broken.length > 3 ? ` and ${broken.length - 3} more` : "";
  return {
    ...base,
    status: "warning",
    passed: false,
    error_message: `${broken.length} broken link${broken.length === 1 ? "" : "s"} of ${checked} checked: ${listed}${more}`,
  };
}
