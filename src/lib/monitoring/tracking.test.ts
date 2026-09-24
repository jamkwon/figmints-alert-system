import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTags, evaluateTags, isTrackingTag } from "./tracking.ts";

const GTM = `<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;})(window,document,'script','dataLayer','GTM-ABC1234');</script>`;
const GA4 = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345"></script>
<script>gtag('js', new Date()); gtag('config', 'G-XYZ12345'); gtag('config', 'AW-123456789');</script>`;
const META = `<script>!function(f,b,e,v){t.src='https://connect.facebook.net/en_US/fbevents.js'}(); fbq('init', '1234567890123456'); fbq('track','PageView');</script>`;
const LINKEDIN = `<script>_linkedin_partner_id = "5551234";</script><script src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>`;
const HUBSPOT = `<script id="hs-script-loader" async defer src="//js.hs-scripts.com/9876543.js"></script>`;

test("detects each tag and its IDs", () => {
  const found = detectTags([GTM, GA4, META, LINKEDIN, HUBSPOT].join("\n"));
  assert.deepEqual(found, {
    gtm: ["GTM-ABC1234"],
    ga4: ["G-XYZ12345"],
    google_ads: ["AW-123456789"],
    meta_pixel: ["1234567890123456"],
    linkedin: ["5551234"],
    hubspot: ["9876543"],
  });
});

test("a page without tags finds nothing", () => {
  assert.deepEqual(detectTags("<html><body><h1>Hello</h1><p>G-7 is a meeting</p></body></html>"), {});
});

test("GA4 isn't claimed from a GTM-only page", () => {
  const found = detectTags(GTM);
  assert.ok(found.gtm);
  assert.equal(found.ga4, undefined);
});

test("missing expected tags fail with their names; extra tags don't matter", () => {
  const found = detectTags([GTM, GA4].join("\n"));
  assert.equal(evaluateTags(["gtm", "ga4"], found, 800.2, 200).status, "passed");
  const outcome = evaluateTags(["gtm", "meta_pixel", "linkedin"], found, 800.2, 200);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error_message, "Missing tracking: Meta Pixel, LinkedIn Insight");
  assert.equal(outcome.response_time_ms, 800);
  assert.equal(evaluateTags([], found, 1, 200).status, "passed");
});

test("only known tag keys are accepted", () => {
  assert.equal(isTrackingTag("ga4"), true);
  assert.equal(isTrackingTag("tiktok"), false);
  assert.equal(isTrackingTag(null), false);
});

test("reads the HubSpot ID from the older analytics snippet", () => {
  const legacy = `n.src='//js.hs-analytics.net/analytics/'+(Math.ceil(new Date()/r)*r)+'/313824.js';`;
  assert.deepEqual(detectTags(legacy), { hubspot: ["313824"] });
});
