import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FeedSplitter,
  evaluateVulnerabilities,
  inAffectedRange,
  inventoryFromWordPress,
  isUrgent,
  matchVulnerabilities,
  noLoginNeeded,
  rangesFromRecord,
  summarizeFindings,
  type InstalledSoftware,
  type VulnerabilityRange,
} from "./vulnerabilities.ts";

// Shaped like a Wordfence Intelligence v3 production record (trimmed).
const RECORD = {
  id: "0004db27-9ea6-4387-ab1d-b95558784ed9",
  title: "We're Open! <= 1.37 - Authenticated (Administrator+) Stored Cross-Site Scripting",
  software: [
    {
      type: "plugin",
      name: "We're Open!",
      slug: "opening-hours",
      affected_versions: {
        "* - 1.37": { from_version: "*", from_inclusive: true, to_version: "1.37", to_inclusive: true },
      },
      patched: true,
      patched_versions: ["1.38"],
    },
  ],
  informational: false,
  references: ["https://www.wordfence.com/threat-intel/vulnerabilities/id/0004db27?source=api-prod"],
  cvss: { vector: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:L/I:L/A:N", score: 5.5, rating: "Medium" },
  published: "2022-09-09 00:00:00",
};

function range(overrides: Partial<VulnerabilityRange> = {}): VulnerabilityRange {
  return {
    vuln_id: "v1",
    software_type: "plugin",
    slug: "contact-form-7",
    from_version: null,
    from_inclusive: true,
    to_version: "5.8.3",
    to_inclusive: true,
    patched_versions: ["5.8.4"],
    title: "Contact Form 7 <= 5.8.3 - Unauthenticated Arbitrary File Upload",
    cvss_score: 9.8,
    cvss_vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
    cvss_rating: "Critical",
    url: "https://www.wordfence.com/threat-intel/vulnerabilities/id/v1",
    published_at: null,
    ...overrides,
  };
}

const CF7: InstalledSoftware = { type: "plugin", slug: "contact-form-7", name: "Contact Form 7", version: "5.8.1", active: true };

test("rangesFromRecord reads one range per affected version span", () => {
  const [r, ...rest] = rangesFromRecord(RECORD);
  assert.equal(rest.length, 0);
  assert.equal(r.vuln_id, RECORD.id);
  assert.equal(r.software_type, "plugin");
  assert.equal(r.slug, "opening-hours");
  assert.equal(r.from_version, null, "* means no lower bound");
  assert.equal(r.to_version, "1.37");
  assert.deepEqual(r.patched_versions, ["1.38"]);
  assert.equal(r.cvss_score, 5.5);
  assert.equal(r.url, RECORD.references[0]);
  assert.equal(r.published_at, "2022-09-09T00:00:00.000Z");
});

test("rangesFromRecord skips informational and malformed records", () => {
  assert.deepEqual(rangesFromRecord({ ...RECORD, informational: true }), []);
  assert.deepEqual(rangesFromRecord({ ...RECORD, software: "nope" }), []);
  assert.deepEqual(rangesFromRecord({ ...RECORD, id: undefined }), []);
  assert.deepEqual(rangesFromRecord(null), []);
  assert.deepEqual(rangesFromRecord({ ...RECORD, software: [{ ...RECORD.software[0], type: "library" }] }), []);
});

test("rangesFromRecord handles a missing CVSS and falls back to the Wordfence URL", () => {
  const [r] = rangesFromRecord({ ...RECORD, cvss: null, references: [] });
  assert.equal(r.cvss_score, null);
  assert.equal(r.cvss_vector, null);
  assert.match(r.url, /^https:\/\/www\.wordfence\.com\/threat-intel\/vulnerabilities\/id\//);
});

test("FeedSplitter yields each record, whatever the chunk boundaries", () => {
  const feed = JSON.stringify({
    a: { id: "a", title: 'Has "quotes" and {braces} and [brackets]', software: [] },
    b: { id: "b", title: "Back\\slash", software: [{ affected_versions: { "* - 1": {} } }] },
  });
  for (const size of [1, 3, 7, 1000]) {
    const splitter = new FeedSplitter();
    const records: unknown[] = [];
    for (let i = 0; i < feed.length; i += size) records.push(...splitter.push(feed.slice(i, i + size)));
    assert.deepEqual(
      records.map((r) => (r as { id: string }).id),
      ["a", "b"],
      `chunk size ${size}`,
    );
    assert.equal((records[0] as { title: string }).title, 'Has "quotes" and {braces} and [brackets]');
    assert.ok(splitter.done);
  }
});

test("FeedSplitter also reads an array feed and reports an unfinished one", () => {
  const splitter = new FeedSplitter();
  assert.equal(splitter.push('[{"id":"a"},{"id":"b"}').length, 2);
  assert.equal(splitter.done, false);
  splitter.push("]");
  assert.ok(splitter.done);
});

test("inventoryFromWordPress reads core, plugins and the site plugin's themes", () => {
  const inv = inventoryFromWordPress({
    wordpress: { version: "6.8.1", latest: "6.8.3", source: "plugin" },
    plugins: [
      { slug: "Contact-Form-7", name: "Contact Form 7", version: "5.8.1", latest: null, source: "plugin", active: false },
      { slug: "elementor", version: null, latest: null, source: "asset" },
      { name: "no slug" },
    ],
    plugin_report: { themes: [{ slug: "astra", name: "Astra", version: "4.1", latest: null, active: true }] },
  });
  assert.ok(inv);
  assert.equal(inv.complete, true);
  assert.deepEqual(inv.software, [
    { type: "core", slug: "wordpress", name: "WordPress", version: "6.8.1", active: true },
    { type: "plugin", slug: "contact-form-7", name: "Contact Form 7", version: "5.8.1", active: false },
    { type: "plugin", slug: "elementor", name: "elementor", version: null, active: null },
    { type: "theme", slug: "astra", name: "Astra", version: "4.1", active: true },
  ]);
});

test("inventoryFromWordPress without the site plugin is partial, and null when the check didn't get that far", () => {
  const inv = inventoryFromWordPress({ wordpress: { version: null }, plugins: [], themes: ["astra"], plugin_report: null });
  assert.deepEqual(inv, { software: [], complete: false });
  assert.equal(inventoryFromWordPress({ final_url: "https://x.test/" }), null);
  assert.equal(inventoryFromWordPress(null), null);
});

test("inAffectedRange respects inclusive and exclusive bounds", () => {
  const r = { from_version: "2.0", from_inclusive: true, to_version: "2.5", to_inclusive: false };
  assert.equal(inAffectedRange("1.9", r), false);
  assert.equal(inAffectedRange("2.0", r), true);
  assert.equal(inAffectedRange("2.4.9", r), true);
  assert.equal(inAffectedRange("2.5", r), false);
  assert.equal(inAffectedRange("2.0", { ...r, from_inclusive: false }), false);
  assert.equal(inAffectedRange("2.5", { ...r, to_inclusive: true }), true);
  assert.equal(inAffectedRange("0.1", { ...r, from_version: null }), true);
  assert.equal(inAffectedRange("99", { ...r, to_version: null }), true);
});

test("noLoginNeeded reads PR:N from the CVSS vector", () => {
  assert.equal(noLoginNeeded("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), true);
  assert.equal(noLoginNeeded("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"), false);
  assert.equal(noLoginNeeded(null), false);
});

test("matchVulnerabilities finds affected versions only, with the lowest fix above the installed one", () => {
  const ranges = [
    range(),
    range({ vuln_id: "v2", to_version: "5.0", title: "Old one" }),
    range({ vuln_id: "v3", slug: "other-plugin" }),
    range({ vuln_id: "v4", software_type: "theme" }),
    range({ vuln_id: "v5", patched_versions: ["5.0", "5.9", "5.8.2"], cvss_score: 4.3 }),
  ];
  const findings = matchVulnerabilities([CF7], ranges);
  assert.deepEqual(findings.map((f) => f.vulnId), ["v1", "v5"]);
  assert.equal(findings[0].fixedIn, "5.8.4");
  assert.equal(findings[0].noLogin, true);
  assert.equal(findings[1].fixedIn, "5.8.2");
});

test("matchVulnerabilities skips unknown versions, dedupes ranges and matches core", () => {
  const ranges = [
    range(),
    range({ from_version: "5.0", to_version: "5.9" }),
    range({ vuln_id: "core1", software_type: "core", slug: "wordpress", to_version: "6.4", patched_versions: [] }),
  ];
  const installed: InstalledSoftware[] = [
    CF7,
    { ...CF7, slug: "unknown", version: null },
    { type: "core", slug: "wordpress", name: "WordPress", version: "6.2", active: true },
  ];
  const findings = matchVulnerabilities(installed, ranges);
  assert.deepEqual(findings.map((f) => f.vulnId).sort(), ["core1", "v1"]);
  assert.equal(findings.find((f) => f.vulnId === "core1")?.fixedIn, null);
});

test("isUrgent needs both the score and no login", () => {
  assert.equal(isUrgent({ cvssScore: 9.8, noLogin: true }, 7), true);
  assert.equal(isUrgent({ cvssScore: 7, noLogin: true }, 7), true);
  assert.equal(isUrgent({ cvssScore: 6.9, noLogin: true }, 7), false);
  assert.equal(isUrgent({ cvssScore: 9.8, noLogin: false }, 7), false);
  assert.equal(isUrgent({ cvssScore: null, noLogin: true }, 7), false);
});

test("summarizeFindings groups per plugin and needs the highest fix", () => {
  const findings = matchVulnerabilities([CF7], [
    range({ cvss_vector: "CVSS:3.1/PR:L", cvss_score: 6.4 }),
    range({ vuln_id: "v2", patched_versions: ["5.9"], cvss_score: 5 }),
  ]);
  const [s] = summarizeFindings(findings, 7);
  assert.equal(s.count, 2);
  assert.equal(s.worstScore, 6.4);
  assert.equal(s.urgent, false);
  assert.equal(s.updateTo, "5.9");
  const [noFix] = summarizeFindings(matchVulnerabilities([CF7], [range(), range({ vuln_id: "v2", patched_versions: [] })]), 7);
  assert.equal(noFix.updateTo, null);
});

test("evaluateVulnerabilities fails on an urgent one and warns on the rest", () => {
  const urgent = matchVulnerabilities([CF7], [range()]);
  const failed = evaluateVulnerabilities({ installed: [CF7], feedLoaded: true, findings: urgent, minCvss: 7 });
  assert.equal(failed.status, "failed");
  assert.match(failed.error_message ?? "", /^Serious, no login needed: Contact Form 7 5\.8\.1 \(1 vulnerability, CVSS 9\.8; update to 5\.8\.4\)/);

  const mild = matchVulnerabilities([CF7], [range({ cvss_vector: "CVSS:3.1/PR:H" })]);
  const warning = evaluateVulnerabilities({ installed: [CF7], feedLoaded: true, findings: mild, minCvss: 7 });
  assert.equal(warning.status, "warning");
  assert.match(warning.error_message ?? "", /^Known vulnerabilities: /);

  const stricter = evaluateVulnerabilities({ installed: [CF7], feedLoaded: true, findings: urgent, minCvss: 10 });
  assert.equal(stricter.status, "warning");
});

test("evaluateVulnerabilities passes with nothing found and warns when it can't check", () => {
  assert.equal(evaluateVulnerabilities({ installed: [CF7], feedLoaded: true, findings: [], minCvss: 7 }).status, "passed");
  const noFeed = evaluateVulnerabilities({ installed: [CF7], feedLoaded: false, findings: [], minCvss: 7 });
  assert.equal(noFeed.status, "warning");
  assert.match(noFeed.error_message ?? "", /hasn't been downloaded/);
  const noInventory = evaluateVulnerabilities({ installed: null, feedLoaded: true, findings: [], minCvss: 7 });
  assert.match(noInventory.error_message ?? "", /WordPress Health/);
});

test("evaluateVulnerabilities keeps the message short", () => {
  const many: InstalledSoftware[] = Array.from({ length: 40 }, (_, i) => ({ ...CF7, slug: `p${i}`, name: `Plugin number ${i}` }));
  const findings = matchVulnerabilities(many, many.map((p) => range({ slug: p.slug, cvss_vector: null })));
  const outcome = evaluateVulnerabilities({ installed: many, feedLoaded: true, findings, minCvss: 7 });
  assert.ok((outcome.error_message ?? "").length <= 500);
});
