// Search visibility: is the page open to search engines? Catches "noindex"
// (meta tag or X-Robots-Tag header, including WordPress's "Discourage search
// engines" setting), a robots.txt that blocks the page, and a canonical URL on
// another domain (e.g. left pointing at a staging site). Pure, so it can be tested.
import type { CheckOutcome } from "./evaluate.ts";

const AGENT = "googlebot";

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function blocksIndexing(directives: string): boolean {
  return /(^|[\s,])(noindex|none)([\s,]|$)/i.test(directives);
}

/** Where the page says "noindex", or null when it's indexable. */
export function findNoindex(html: string, xRobotsTag: string | null): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = attr(tag, "name")?.toLowerCase();
    if ((name === "robots" || name === AGENT) && blocksIndexing(attr(tag, "content") ?? "")) {
      return `<meta name="${name}" content="${attr(tag, "content")}">`;
    }
  }
  if (xRobotsTag) {
    // "noindex, nofollow", or per crawler: "otherbot: noindex, googlebot: none".
    let agent: string | null = null;
    for (const part of xRobotsTag.split(",")) {
      const scoped = part.match(/^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i);
      if (scoped && !/^(unavailable_after|max-[a-z-]+)$/i.test(scoped[1])) {
        agent = scoped[1].toLowerCase();
        if ((agent === AGENT || agent === "*") && blocksIndexing(scoped[2])) return `X-Robots-Tag: ${xRobotsTag.trim()}`;
      } else if ((agent === null || agent === AGENT) && blocksIndexing(part)) {
        return `X-Robots-Tag: ${xRobotsTag.trim()}`;
      }
    }
  }
  return null;
}

/** The page's canonical URL, when it's on another domain (www. ignored). */
export function foreignCanonical(html: string, pageUrl: URL): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/(^|\s)canonical(\s|$)/i.test(attr(tag, "rel") ?? "")) continue;
    const href = attr(tag, "href");
    if (!href) return null;
    try {
      const canonical = new URL(href, pageUrl);
      const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
      return bare(canonical.hostname) === bare(pageUrl.hostname) ? null : canonical.toString();
    } catch {
      return null;
    }
  }
  return null;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/**
 * Whether robots.txt keeps Googlebot from `path`, following Google's rules: the
 * most specific user-agent group applies ("googlebot" over "*"), the longest
 * matching rule wins, and a tie goes to Allow. An empty "Disallow:" allows all.
 */
export function robotsBlocks(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && AGENT.startsWith(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best !== null && !best.allow;
}

export interface VisibilityFindings {
  /** Where the page says noindex, if it does. */
  noindex: string | null;
  /** robots.txt: HTTP status (null if unreachable), and whether it blocks the page. */
  robots: { status: number | null; blocks: boolean };
  /** Canonical URL on another domain, if any. */
  foreignCanonical: string | null;
}

/** Failed when search engines are kept out; Warning for things that deserve a look. */
export function evaluateVisibility(f: VisibilityFindings, responseTimeMs: number, pageStatus: number): CheckOutcome {
  const base = { http_status: pageStatus, response_time_ms: Math.round(responseTimeMs) };
  const failures: string[] = [];
  const warnings: string[] = [];
  if (f.noindex) failures.push(`Page tells search engines not to index it (${f.noindex})`);
  if (f.robots.blocks) failures.push("robots.txt blocks search engines from this page");
  if (f.robots.status !== null && f.robots.status >= 500) {
    warnings.push(`robots.txt answers HTTP ${f.robots.status}, so Google pauses crawling the site`);
  } else if (f.robots.status === null) {
    warnings.push("robots.txt couldn't be reached, so Google may pause crawling the site");
  }
  if (f.foreignCanonical) warnings.push(`Canonical URL points to another domain (${f.foreignCanonical})`);
  if (failures.length > 0) {
    return { ...base, status: "failed", passed: false, error_message: [...failures, ...warnings].join("; ") };
  }
  if (warnings.length > 0) return { ...base, status: "warning", passed: false, error_message: warnings.join("; ") };
  return { ...base, status: "passed", passed: true, error_message: null };
}
