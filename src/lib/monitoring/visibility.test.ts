import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeft, domainCandidates, evaluateDomain, parseRdap, rdapBaseFor } from "./domain.ts";
import { evaluateVisibility, findNoindex, foreignCanonical, robotsBlocks } from "./visibility.ts";

// figmints.com's real robots.txt (Yoast), 2026-09-29.
const FIGMINTS_ROBOTS = `Crawl-delay: 10
# START YOAST BLOCK
# ---------------------------
User-agent: *
Disallow:

Sitemap: http://www.figmints.com/sitemap_index.xml
# ---------------------------
# END YOAST BLOCK`;

test("robots.txt: figmints.com allows everything", () => {
  assert.equal(robotsBlocks(FIGMINTS_ROBOTS, "/"), false);
  assert.equal(robotsBlocks("", "/"), false, "empty file allows all");
});

test("robots.txt: blocking everything, or just this page", () => {
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /", "/"), true);
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /*", "/about/"), true);
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php", "/"), false, "WordPress default");
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /private", "/private/page"), true);
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /$", "/"), true, "$ anchors the end");
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /$", "/about"), false);
});

test("robots.txt: Google's rules for groups and conflicts", () => {
  // A Googlebot group replaces the * group for Googlebot.
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /", "/"), false);
  assert.equal(robotsBlocks("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/"), true);
  // Rules for other crawlers don't apply.
  assert.equal(robotsBlocks("User-agent: Bingbot\nDisallow: /", "/"), false);
  // Several user-agent lines share one group.
  assert.equal(robotsBlocks("User-agent: Bingbot\nUser-agent: Googlebot\nDisallow: /", "/"), true);
  // Longest match wins; a tie goes to Allow.
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /\nAllow: /blog", "/blog/post"), false);
  assert.equal(robotsBlocks("User-agent: *\nDisallow: /blog\nAllow: /blog", "/blog"), false);
});

test("noindex from meta tags (WordPress 'Discourage search engines') and headers", () => {
  // figmints.com production and staging, as served on 2026-09-29.
  assert.equal(findNoindex("<meta name='robots' content='index, follow, max-image-preview:large' />", null), null);
  assert.match(findNoindex("<meta name='robots' content='noindex, nofollow' />", null)!, /noindex, nofollow/);
  assert.ok(findNoindex(`<meta content="none" name="googlebot">`, null), "attribute order and 'none'");
  assert.equal(findNoindex(`<meta name="bingbot" content="noindex">`, null), null, "other crawlers don't count");
  assert.ok(findNoindex("", "noindex, nofollow"));
  assert.ok(findNoindex("", "googlebot: noindex"));
  assert.equal(findNoindex("", "bingbot: noindex"), null);
  assert.ok(findNoindex("", "bingbot: noindex, googlebot: none"));
  assert.equal(findNoindex("", "unavailable_after: 25 Jun 2030 15:00:00 PST"), null);
});

test("a canonical URL on another domain is spotted (www. ignored)", () => {
  const page = new URL("https://www.figmints.com/");
  assert.equal(foreignCanonical(`<link rel="canonical" href="https://www.figmints.com/" />`, page), null);
  assert.equal(foreignCanonical(`<link rel="canonical" href="https://figmints.com/" />`, page), null);
  assert.equal(foreignCanonical(`<link href="/about/" rel="canonical">`, page), null, "relative is same-site");
  assert.equal(
    foreignCanonical(`<link rel="canonical" href="https://figstaging2.wpengine.com/" />`, page),
    "https://figstaging2.wpengine.com/",
  );
});

test("visibility: noindex or blocked fails; robots.txt errors and foreign canonicals warn", () => {
  const ok = { noindex: null, robots: { status: 200, blocks: false }, foreignCanonical: null };
  assert.equal(evaluateVisibility(ok, 100, 200).status, "passed");
  assert.equal(evaluateVisibility({ ...ok, robots: { status: 404, blocks: false } }, 100, 200).status, "passed", "no robots.txt is fine");
  const noindex = evaluateVisibility({ ...ok, noindex: "<meta name=\"robots\" content=\"noindex\">" }, 100, 200);
  assert.equal(noindex.status, "failed");
  assert.match(noindex.error_message!, /not to index/);
  assert.equal(evaluateVisibility({ ...ok, robots: { status: 200, blocks: true } }, 100, 200).status, "failed");
  assert.equal(evaluateVisibility({ ...ok, robots: { status: 503, blocks: false } }, 100, 200).status, "warning");
  assert.equal(evaluateVisibility({ ...ok, foreignCanonical: "https://x.wpengine.com/" }, 100, 200).status, "warning");
});

// figmints.com's real RDAP answer (trimmed), 2026-09-29.
const FIGMINTS_RDAP = {
  events: [
    { eventAction: "registration", eventDate: "2006-02-02T17:30:18Z" },
    { eventAction: "expiration", eventDate: "2027-02-02T17:30:18Z" },
  ],
  status: ["client transfer prohibited"],
  entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Name.com, Inc."]]] }],
};

test("domain: candidates, RDAP server and parsing", () => {
  assert.deepEqual(domainCandidates("www.figmints.com"), ["figmints.com", "www.figmints.com"]);
  assert.deepEqual(domainCandidates("figmints.com"), ["figmints.com"]);
  assert.deepEqual(domainCandidates("shop.example.co.uk"), ["co.uk", "example.co.uk"]);
  assert.deepEqual(domainCandidates("localhost"), []);
  const bootstrap = { services: [[["com", "net"], ["https://rdap.verisign.com/com/v1/"]], [["uk"], ["http://insecure.example/", "https://rdap.nominet.uk/uk"]]] };
  assert.equal(rdapBaseFor("figmints.com", bootstrap), "https://rdap.verisign.com/com/v1/");
  assert.equal(rdapBaseFor("example.co.uk", bootstrap), "https://rdap.nominet.uk/uk/", "https only, trailing slash added");
  assert.equal(rdapBaseFor("example.io", bootstrap), null, "no RDAP for this TLD");
  const info = parseRdap("figmints.com", FIGMINTS_RDAP);
  assert.deepEqual(info, {
    domain: "figmints.com",
    expiresAt: "2027-02-02T17:30:18.000Z",
    registrar: "Name.com, Inc.",
    statuses: ["client transfer prohibited"],
  });
  assert.equal(daysLeft(info.expiresAt!, new Date("2026-09-29T12:00:00Z")), 126);
});

test("domain: warning within 30 days, failed within 7, expired or in redemption", () => {
  const info = parseRdap("figmints.com", FIGMINTS_RDAP);
  const at = (iso: string) => evaluateDomain(info, new Date(iso), 50);
  assert.equal(at("2026-09-29T12:00:00Z").status, "passed");
  assert.equal(at("2027-01-10T12:00:00Z").status, "warning");
  assert.match(at("2027-01-10T12:00:00Z").error_message!, /expires in 23 days/);
  assert.equal(at("2027-01-30T12:00:00Z").status, "failed");
  assert.match(at("2027-02-10T12:00:00Z").error_message!, /expired 7 days ago/);
  const redemption = evaluateDomain({ ...info, statuses: ["redemption period"] }, new Date("2026-09-29T12:00:00Z"), 50);
  assert.equal(redemption.status, "failed");
  assert.equal(evaluateDomain({ ...info, expiresAt: null }, new Date(), 50).status, "warning");
});
