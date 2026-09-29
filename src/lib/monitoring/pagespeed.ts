// Page speed from Google PageSpeed Insights (Lighthouse lab test + Chrome UX
// Report field data). Pure: parses the API response and applies the rules.
// A slow page isn't an outage, so this only ever warns.
import type { CheckOutcome } from "./evaluate.ts";

export const PAGESPEED_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** Google ranks mobile-first, so tests use the mobile profile. */
export const PAGESPEED_STRATEGY = "mobile";

export interface FieldMetric {
  /** 75th percentile: ms for LCP/INP/FCP; CLS as a decimal (e.g. 0.05). */
  p75: number;
  category: "FAST" | "AVERAGE" | "SLOW" | null;
}

export interface PageSpeedResult {
  /** Lighthouse performance score, 0–100. */
  score: number | null;
  finalUrl: string | null;
  lighthouseVersion: string | null;
  lab: { fcpMs: number | null; lcpMs: number | null; tbtMs: number | null; cls: number | null; speedIndexMs: number | null };
  /** Real-user Core Web Vitals (Chrome UX Report, last 28 days); null without enough traffic. */
  field: {
    /** "page" for this URL, "origin" when Google only has data for the whole site. */
    source: "page" | "origin";
    lcp: FieldMetric | null;
    inp: FieldMetric | null;
    cls: FieldMetric | null;
  } | null;
  /** Biggest improvements Lighthouse suggests, with the time they'd save. */
  opportunities: { title: string; savingsMs: number }[];
  /** Lighthouse couldn't test the page (e.g. it didn't load for Google). */
  runtimeError: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function fieldMetric(metrics: Json, key: string, scale = 1): FieldMetric | null {
  const m = obj(metrics[key]);
  const p75 = num(m.percentile);
  if (p75 === null) return null;
  const category = m.category === "FAST" || m.category === "AVERAGE" || m.category === "SLOW" ? m.category : null;
  return { p75: p75 / scale, category };
}

function fieldData(experience: unknown): { lcp: FieldMetric | null; inp: FieldMetric | null; cls: FieldMetric | null } | null {
  const metrics = obj(obj(experience).metrics);
  const lcp = fieldMetric(metrics, "LARGEST_CONTENTFUL_PAINT_MS");
  const inp = fieldMetric(metrics, "INTERACTION_TO_NEXT_PAINT");
  // The API reports CLS × 100.
  const cls = fieldMetric(metrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE", 100);
  return lcp || inp || cls ? { lcp, inp, cls } : null;
}

/** Reads a PageSpeed Insights v5 response. */
export function parsePageSpeed(body: unknown): PageSpeedResult {
  const root = obj(body);
  const lr = obj(root.lighthouseResult);
  const audits = obj(lr.audits);
  const audit = (id: string) => obj(audits[id]);
  const score = num(obj(obj(lr.categories).performance).score);
  const runtime = obj(lr.runtimeError);

  // Page-level field data when Google has it; otherwise the whole site's.
  const page = obj(root.loadingExperience);
  const pageData = page.origin_fallback === true ? null : fieldData(page);
  const originData = pageData ? null : fieldData(root.originLoadingExperience);

  const opportunities = Object.values(audits)
    .map(obj)
    .flatMap((a) => {
      const title = typeof a.title === "string" ? a.title : null;
      const savings = num(obj(a.details).overallSavingsMs) ?? num(obj(a.metricSavings).LCP) ?? 0;
      const passed = num(a.score) !== null && (a.score as number) >= 0.9;
      return title && savings >= 100 && !passed ? [{ title: title.slice(0, 120), savingsMs: Math.round(savings) }] : [];
    })
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 3);

  return {
    score: score === null ? null : Math.round(score * 100),
    finalUrl: typeof lr.finalDisplayedUrl === "string" ? lr.finalDisplayedUrl : typeof lr.finalUrl === "string" ? lr.finalUrl : null,
    lighthouseVersion: typeof lr.lighthouseVersion === "string" ? lr.lighthouseVersion : null,
    lab: {
      fcpMs: num(audit("first-contentful-paint").numericValue),
      lcpMs: num(audit("largest-contentful-paint").numericValue),
      tbtMs: num(audit("total-blocking-time").numericValue),
      cls: num(audit("cumulative-layout-shift").numericValue),
      speedIndexMs: num(audit("speed-index").numericValue),
    },
    field: pageData ? { source: "page", ...pageData } : originData ? { source: "origin", ...originData } : null,
    opportunities,
    runtimeError: typeof runtime.code === "string" ? `${runtime.code}${typeof runtime.message === "string" ? `: ${runtime.message}` : ""}`.slice(0, 300) : null,
  };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Core Web Vitals assessment, like PageSpeed shows it: passes when every metric
 * with data (LCP, INP, CLS) is "good" at the 75th percentile.
 */
export function failingVitals(field: PageSpeedResult["field"]): string[] {
  if (!field) return [];
  const failing: string[] = [];
  if (field.lcp && field.lcp.category !== "FAST") failing.push(`LCP ${seconds(field.lcp.p75)}`);
  if (field.inp && field.inp.category !== "FAST") failing.push(`INP ${Math.round(field.inp.p75)} ms`);
  if (field.cls && field.cls.category !== "FAST") failing.push(`CLS ${field.cls.p75.toFixed(2)}`);
  return failing;
}

/** A drop of this many points below last week's typical score warns (Lighthouse scores wobble by a few). */
export const SCORE_DROP_POINTS = 15;

/** Last week's typical score: the median of its scores, when there are at least two. */
export function scoreBaseline(previous: number[]): number | null {
  const scores = previous.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  if (scores.length < 2) return null;
  const mid = Math.floor(scores.length / 2);
  return Math.round(scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2);
}

/**
 * Warning below the minimum score, after a sharp drop from last week's typical
 * score, or when real-user Core Web Vitals fail; never Failed.
 */
export function evaluatePageSpeed(
  r: PageSpeedResult,
  minScore: number,
  responseTimeMs: number,
  baseline: number | null = null,
): CheckOutcome {
  const base = { http_status: null, response_time_ms: Math.round(responseTimeMs) };
  const warnings: string[] = [];
  if (r.runtimeError) warnings.push(`PageSpeed couldn't test the page (${r.runtimeError})`);
  else if (r.score === null) warnings.push("PageSpeed didn't return a score");
  else if (r.score < minScore) {
    const lcp = r.lab.lcpMs !== null ? `, LCP ${seconds(r.lab.lcpMs)}` : "";
    warnings.push(`Performance score ${r.score}/100 on mobile (below ${minScore}${lcp})`);
  }
  if (r.score !== null && baseline !== null && r.score <= baseline - SCORE_DROP_POINTS) {
    warnings.push(`Score dropped to ${r.score} from about ${baseline} last week`);
  }
  const vitals = failingVitals(r.field);
  if (vitals.length > 0) {
    const where = r.field?.source === "origin" ? " (whole site)" : "";
    warnings.push(`Core Web Vitals failing for real visitors${where}: ${vitals.join(", ")}`);
  }
  if (warnings.length > 0) return { ...base, status: "warning", passed: false, error_message: warnings.join("; ") };
  return { ...base, status: "passed", passed: true, error_message: null };
}
