// Tracking tag detection from a page's HTML. Pure (relative imports only) so it
// can be tested directly.
import type { CheckOutcome } from "./evaluate.ts";

export type TrackingTag = "gtm" | "ga4" | "google_ads" | "meta_pixel" | "linkedin" | "hubspot";

interface TagRule {
  label: string;
  /** Any of these means the tag's code is on the page. */
  markers: RegExp[];
  /** Pulls out account/container IDs for display. */
  ids: RegExp[];
}

export const TRACKING_TAGS: Record<TrackingTag, TagRule> = {
  gtm: {
    label: "Google Tag Manager",
    markers: [/googletagmanager\.com\/gtm\.js/i, /\bGTM-[A-Z0-9]{4,10}\b/],
    ids: [/\b(GTM-[A-Z0-9]{4,10})\b/g],
  },
  ga4: {
    label: "Google Analytics 4",
    markers: [/googletagmanager\.com\/gtag\/js\?[^"'\s]*id=G-/i, /gtag\(\s*['"]config['"]\s*,\s*['"]G-/i],
    ids: [/\b(G-[A-Z0-9]{6,12})\b/g],
  },
  google_ads: {
    label: "Google Ads",
    markers: [/\bAW-\d{6,12}\b/, /googleadservices\.com\/pagead\/conversion/i],
    ids: [/\b(AW-\d{6,12})\b/g],
  },
  meta_pixel: {
    label: "Meta Pixel",
    markers: [/connect\.facebook\.net\/[^"']*\/fbevents\.js/i, /fbq\(\s*['"]init['"]/i],
    ids: [/fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g],
  },
  linkedin: {
    label: "LinkedIn Insight",
    markers: [/snap\.licdn\.com\/li\.lms-analytics/i, /_linkedin_partner_id/i],
    ids: [/_linkedin_partner_id\s*=\s*['"]?(\d{4,12})/g],
  },
  hubspot: {
    label: "HubSpot",
    markers: [/js(?:-[a-z0-9]+)?\.hs-scripts\.com\/\d+\.js/i, /js\.hs-analytics\.net/i, /js\.hsforms\.net/i],
    // Current loader (hs-scripts.com/123.js) and the older snippet that builds
    // js.hs-analytics.net/analytics/<timestamp>/123.js in pieces.
    ids: [/hs-scripts\.com\/(\d+)\.js/g, /hs-analytics\.net\/analytics\/.{0,80}?\/(\d{4,10})\.js/g],
  },
};

export const TRACKING_TAG_KEYS = Object.keys(TRACKING_TAGS) as TrackingTag[];

export function isTrackingTag(value: unknown): value is TrackingTag {
  return typeof value === "string" && value in TRACKING_TAGS;
}

/** Tags found on the page, each with the IDs seen (possibly none). */
export function detectTags(html: string): Partial<Record<TrackingTag, string[]>> {
  const found: Partial<Record<TrackingTag, string[]>> = {};
  for (const key of TRACKING_TAG_KEYS) {
    const rule = TRACKING_TAGS[key];
    if (!rule.markers.some((m) => m.test(html))) continue;
    const ids = new Set<string>();
    for (const pattern of rule.ids) for (const match of html.matchAll(pattern)) ids.add(match[1]);
    found[key] = [...ids].slice(0, 10);
  }
  return found;
}

/** Failed (listing what's missing) when any expected tag isn't on the page. */
export function evaluateTags(
  expected: TrackingTag[],
  found: Partial<Record<TrackingTag, string[]>>,
  responseTimeMs: number,
  pageStatus: number,
): CheckOutcome {
  const base = { http_status: pageStatus, response_time_ms: Math.round(responseTimeMs) };
  const missing = expected.filter((tag) => !found[tag]);
  if (missing.length === 0) return { ...base, status: "passed", passed: true, error_message: null };
  return {
    ...base,
    status: "failed",
    passed: false,
    error_message: `Missing tracking: ${missing.map((t) => TRACKING_TAGS[t].label).join(", ")}`,
  };
}
