import assert from "node:assert/strict";
import test from "node:test";
import type { WpeInstall } from "./wordpress.ts";
import { buildCandidates, checksPerDay, isSuggested, monitorsForImport, type WpeSite } from "./wpengine-import.ts";

function install(id: string, over: Partial<WpeInstall> = {}): WpeInstall {
  return {
    id,
    name: `inst${id}`,
    environment: "production",
    status: "active",
    php_version: "8.2",
    wp_version: null,
    primary_domain: null,
    cname: `inst${id}.wpengine.com`,
    defer_wordpress_upgrades_until: null,
    ...over,
  };
}

const installs = [
  install("1", { primary_domain: "www.bluefinch.com" }),
  install("2", { primary_domain: "acme.org" }),
  install("3"),
  install("4", { primary_domain: "staging.acme.org", environment: "staging" }),
  install("5", { primary_domain: "sandbox.example" }),
];
const sites: WpeSite[] = [
  { id: "s1", name: "Blue Finch", sandbox: false, installIds: ["1"] },
  { id: "s2", name: "ACME", sandbox: false, installIds: ["2", "4"] },
  { id: "s3", name: "Not launched", sandbox: false, installIds: ["3"] },
  { id: "s5", name: "Playground", sandbox: true, installIds: ["5"] },
];

test("buildCandidates lists production installs and spots monitored domains", () => {
  const rows = buildCandidates(installs, sites, [{ url: "https://bluefinch.com/", clientName: "Blue Finch Bakery" }], ["acme"]);
  assert.deepEqual(
    rows.map((r) => r.installId),
    ["2", "3", "5", "1"],
    "staging is left out; monitored sites sort last",
  );
  const blue = rows.find((r) => r.installId === "1")!;
  assert.equal(blue.monitoredBy, "Blue Finch Bakery", "www. is ignored when matching");
  assert.equal(blue.url, "https://www.bluefinch.com/");
  const acme = rows.find((r) => r.installId === "2")!;
  assert.equal(acme.existingClient, "acme", "client names match case-insensitively");
  const bare = rows.find((r) => r.installId === "3")!;
  assert.equal(bare.domain, "inst3.wpengine.com");
  assert.equal(bare.wpeDomainOnly, true);
});

test("isSuggested skips monitored, wpengine.com-only and sandbox installs", () => {
  const rows = buildCandidates(installs, sites, [{ url: "https://bluefinch.com/", clientName: "Blue Finch" }], []);
  assert.deepEqual(
    rows.filter(isSuggested).map((r) => r.installId),
    ["2"],
  );
});

test("a site already monitored at its wpengine.com address counts as monitored", () => {
  const rows = buildCandidates([install("3")], sites, [{ url: "https://inst3.wpengine.com", clientName: "X" }], []);
  assert.equal(rows[0].monitoredBy, "X");
});

test("checksPerDay adds up intervals", () => {
  assert.equal(checksPerDay([15, 360, 1440]), 96 + 4 + 1);
  assert.equal(checksPerDay([]), 0);
});

test("monitorsForImport builds the chosen checks with spread-out first checks", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const rows = monitorsForImport(
    { id: "w1", url: "https://www.acme.org/" },
    { uptime: true, ssl: true, wordpress: true, interval: 15, severity: "critical" },
    now,
    () => 0.5,
  );
  assert.deepEqual(
    rows.map((r) => [r.monitor_type, r.interval_minutes, r.next_check_at]),
    [
      ["http_status", 15, "2026-09-28T12:07:30.000Z"],
      ["ssl_expiry", 360, "2026-09-28T15:00:00.000Z"],
      ["wordpress_health", 360, "2026-09-28T15:00:00.000Z"],
    ],
  );
  assert.ok(rows.every((r) => r.website_id === "w1" && r.severity_on_failure === "critical"));
  assert.equal(rows[1].target_url, "https://www.acme.org/");
  const onlySsl = monitorsForImport(
    { id: "w1", url: "https://acme.org/" },
    { uptime: false, ssl: true, wordpress: false, interval: 15, severity: "warning" },
    now,
  );
  assert.deepEqual(onlySsl.map((r) => r.monitor_type), ["ssl_expiry"]);
});
