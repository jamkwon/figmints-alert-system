import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePageSpeed, failingVitals, parsePageSpeed } from "./pagespeed.ts";

// Shaped like a PageSpeed Insights v5 response (trimmed).
const RESPONSE = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: "AVERAGE" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150, category: "FAST" },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
    },
    overall_category: "AVERAGE",
  },
  originLoadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000, category: "FAST" } } },
  lighthouseResult: {
    lighthouseVersion: "12.8.2",
    finalDisplayedUrl: "https://www.figmints.com/",
    categories: { performance: { score: 0.43 } },
    audits: {
      "first-contentful-paint": { numericValue: 2100.4 },
      "largest-contentful-paint": { numericValue: 5234.1 },
      "total-blocking-time": { numericValue: 610 },
      "cumulative-layout-shift": { numericValue: 0.012 },
      "speed-index": { numericValue: 4800 },
      "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.3, details: { type: "opportunity", overallSavingsMs: 1250 } },
      "uses-responsive-images": { title: "Properly size images", score: 0.5, details: { type: "opportunity", overallSavingsMs: 800 } },
      "modern-image-formats": { title: "Serve images in next-gen formats", score: 0.95, details: { overallSavingsMs: 300 } },
      "lcp-discovery-insight": { title: "LCP request discovery", score: 0, metricSavings: { LCP: 450 } },
      "tiny-win": { title: "Tiny", score: 0.5, details: { overallSavingsMs: 40 } },
    },
  },
};

test("parsePageSpeed reads the score, lab metrics, field data and top opportunities", () => {
  const r = parsePageSpeed(RESPONSE);
  assert.equal(r.score, 43);
  assert.equal(r.finalUrl, "https://www.figmints.com/");
  assert.equal(r.lab.lcpMs, 5234.1);
  assert.equal(r.field?.source, "page");
  assert.deepEqual(r.field?.cls, { p75: 0.05, category: "FAST" }, "CLS comes × 100");
  assert.deepEqual(r.opportunities, [
    { title: "Eliminate render-blocking resources", savingsMs: 1250 },
    { title: "Properly size images", savingsMs: 800 },
    { title: "LCP request discovery", savingsMs: 450 },
  ], "passed (≥ 0.9) and tiny savings are left out");
  assert.equal(r.runtimeError, null);
});

test("field data falls back to the whole site, or is absent without traffic", () => {
  const origin = parsePageSpeed({ ...RESPONSE, loadingExperience: { ...RESPONSE.originLoadingExperience, origin_fallback: true } });
  assert.equal(origin.field?.source, "origin");
  const none = parsePageSpeed({ lighthouseResult: RESPONSE.lighthouseResult });
  assert.equal(none.field, null);
  assert.deepEqual(failingVitals(none.field), []);
});

test("warnings: score below the minimum, Core Web Vitals failing, Lighthouse errors", () => {
  const r = parsePageSpeed(RESPONSE);
  const slow = evaluatePageSpeed(r, 50, 20000);
  assert.equal(slow.status, "warning");
  assert.equal(
    slow.error_message,
    "Performance score 43/100 on mobile (below 50, LCP 5.2 s); Core Web Vitals failing for real visitors: LCP 3.1 s",
  );
  assert.equal(evaluatePageSpeed({ ...r, field: null }, 40, 1).status, "passed", "43 is fine with a minimum of 40");
  assert.equal(evaluatePageSpeed({ ...r, field: null }, 0, 1).status, "passed", "0 turns the score rule off");
  const broken = parsePageSpeed({ lighthouseResult: { runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "Unable to load the page" } } });
  assert.match(evaluatePageSpeed(broken, 50, 1).error_message!, /couldn't test the page \(FAILED_DOCUMENT_REQUEST/);
  assert.equal(evaluatePageSpeed(broken, 50, 1).status, "warning", "never Failed: other monitors cover downtime");
});

test("a sharp drop from last week's typical score warns", async () => {
  const { scoreBaseline, SCORE_DROP_POINTS } = await import("./pagespeed.ts");
  assert.equal(scoreBaseline([64, 70, 66]), 66, "median");
  assert.equal(scoreBaseline([60, 70]), 65);
  assert.equal(scoreBaseline([61]), null, "one score isn't a trend");
  const r = { ...parsePageSpeed(RESPONSE), field: null };
  const at = (score: number, baseline: number | null) => evaluatePageSpeed({ ...r, score }, 40, 1, baseline);
  assert.equal(at(66 - SCORE_DROP_POINTS + 1, 66).status, "passed", "a small wobble is fine");
  assert.equal(at(66 - SCORE_DROP_POINTS, 66).error_message, "Score dropped to 51 from about 66 last week");
  assert.equal(at(51, null).status, "passed", "no history, no comparison");
});
