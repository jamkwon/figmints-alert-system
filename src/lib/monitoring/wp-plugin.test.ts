import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePluginReport, wordpressProblems, type WordPressFacts } from "./wordpress.ts";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WP_PLUGIN_VERSION,
  pluginSource,
  pluginZip,
  publicKeyBase64,
  signRequest,
  signedMessage,
} from "./wp-plugin.ts";

// Trimmed from a real response of the plugin on WordPress 7.1.2 (WordPress Playground).
const REPORT = {
  plugin_version: "1.0.0",
  generated_at: "2026-09-28T18:33:45+00:00",
  multisite: false,
  wordpress: { version: "7.1.2", update: "9.9.9", checked_at: "2026-09-28T17:33:45+00:00" },
  php: { version: "8.3.33", memory_limit: "256M" },
  debug_display: false,
  cron: { disabled: false, overdue_minutes: 0 },
  plugins: [
    { file: "akismet/akismet.php", name: "Akismet Anti-spam: Spam Protection", version: "5.7.2", active: false, update: null },
    { file: "hello.php", name: "Hello Dolly", version: "1.7.2", active: false, update: null },
    { file: "premium-pro/premium-pro.php", name: "Premium Pro", version: "2.1.0", active: false, update: "2.3.0" },
  ],
  plugins_checked_at: "2026-09-28T17:33:45+00:00",
  themes: [{ slug: "twentytwentyfive", name: "Twenty Twenty-Five", version: "1.5", active: true, update: null }],
};

const now = new Date("2026-09-28T19:00:00Z");
const base: WordPressFacts = {
  wpVersion: "7.1.2",
  latestWpVersion: "7.1.2",
  phpVersion: "8.3.33",
  install: null,
  backups: null,
  outdatedPlugins: [],
  isWordPress: true,
};

test("parsePluginReport reads the plugin's response", () => {
  const r = parsePluginReport(REPORT)!;
  assert.equal(r.wordpress.version, "7.1.2");
  assert.equal(r.wordpress.update, "9.9.9");
  assert.equal(r.php.memoryLimit, "256M");
  assert.deepEqual(
    r.plugins.map((p) => [p.id, p.version, p.update]),
    [
      ["akismet/akismet.php", "5.7.2", null],
      ["hello.php", "1.7.2", null],
      ["premium-pro/premium-pro.php", "2.1.0", "2.3.0"],
    ],
  );
  assert.equal(r.themes[0].active, true);
});

test("parsePluginReport rejects anything that isn't a report", () => {
  assert.equal(parsePluginReport({ code: "rest_no_route" }), null);
  assert.equal(parsePluginReport(null), null);
  assert.equal(parsePluginReport([1, 2]), null);
  const r = parsePluginReport({ ...REPORT, plugins: [{ name: "no file" }, "junk", ...REPORT.plugins] })!;
  assert.equal(r.plugins.length, 3, "malformed entries are skipped");
});

test("a healthy plugin report adds no problems", () => {
  assert.deepEqual(wordpressProblems({ ...base, report: parsePluginReport(REPORT) }, now), []);
});

test("theme updates, visible debug errors, stuck WP-Cron and stale update checks are warnings", () => {
  const report = parsePluginReport({
    ...REPORT,
    debug_display: true,
    cron: { disabled: false, overdue_minutes: 300 },
    plugins_checked_at: "2026-09-24T00:00:00+00:00",
    themes: [{ ...REPORT.themes[0], update: "1.6" }],
  });
  assert.deepEqual(
    wordpressProblems({ ...base, report }, now).map((p) => [p.level, p.message]),
    [
      ["warning", "1 theme with updates available"],
      ["warning", "Debug mode shows PHP errors to visitors (WP_DEBUG_DISPLAY)"],
      ["warning", "WP-Cron is 5 hours behind"],
      ["warning", "WordPress hasn't checked for plugin updates in 3 days, so updates may be missing"],
    ],
  );
});

test("a site with the plugin isn't reported as 'WordPress not detected'", () => {
  const problems = wordpressProblems({ ...base, isWordPress: false, report: parsePluginReport(REPORT) }, now);
  assert.equal(problems.some((p) => p.message.includes("not detected")), false);
});

const { privateKey } = generateKeyPairSync("ed25519");

/** Verifies like the plugin does: raw 32-byte public key, message rebuilt from its own host. */
function pluginAccepts(publicKey: string, host: string, headers: Record<string, string>): boolean {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  const message = signedMessage(host, Number(headers[TIMESTAMP_HEADER]));
  return verify(null, Buffer.from(message), key, Buffer.from(headers[SIGNATURE_HEADER], "base64"));
}

test("a signed request verifies with the public key for that host only", () => {
  const pub = publicKeyBase64(privateKey);
  const headers = signRequest(privateKey, "www.figmints.com", Date.parse("2026-09-28T19:00:00Z"));
  assert.equal(headers[TIMESTAMP_HEADER], "1790622000");
  assert.equal(Buffer.from(headers[SIGNATURE_HEADER], "base64").length, 64);
  assert.equal(pluginAccepts(pub, "www.figmints.com", headers), true);
  assert.equal(pluginAccepts(pub, "other-client.com", headers), false, "useless on another site");
  const other = publicKeyBase64(generateKeyPairSync("ed25519").privateKey);
  assert.equal(pluginAccepts(other, "www.figmints.com", headers), false, "another key can't sign for us");
});

test("the downloaded plugin carries only the public key", () => {
  const pub = publicKeyBase64(privateKey);
  const php = pluginSource(pub);
  assert.ok(php.startsWith("<?php"));
  assert.ok(php.includes(`define('WEBSITE_WATCH_PUBLIC_KEY', '${pub}');`));
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  assert.ok(!php.includes(privateDer.subarray(-32).toString("base64")), "the private key is never in the file");
  assert.ok(!/__[A-Z_]+__/.test(php), "every placeholder is filled in");
  assert.ok(php.includes(`Version: ${WP_PLUGIN_VERSION}`));
  assert.ok(php.includes(" * Update URI: false\n"), "wordpress.org can never replace it");
  // A second copy must not redeclare functions: every function sits inside the guard.
  const guard = php.indexOf("if (!defined('WEBSITE_WATCH_HEALTH_VERSION')) {\n");
  assert.ok(guard > 0 && php.trimEnd().endsWith("\t}\n}"), "code is wrapped in the load guard");
  assert.ok(!/^function /m.test(php), "no top-level function declarations");
  // The PHP source must contain the escapes themselves: '/^www\\./' (PHP makes it /^www\./) and "\n".
  assert.ok(php.includes("preg_replace('/^www\\\\./', '', $host)"), "PHP regex escaping survives the template");
  assert.ok(php.includes('"website-watch-health/v1\\n" . $host . "\\n" . $timestamp'), "same message format as signedMessage");
  assert.throws(() => pluginSource("not-a-key"));
  const zip = pluginZip(pub);
  assert.ok(zip.includes(Buffer.from("website-watch-health/website-watch-health.php")), "zip has the folder WordPress expects");
  assert.ok(zip.includes(Buffer.from(php)), "zip holds the same plugin file");
  assert.throws(() => pluginSource("x'); system('id'); //" + "A".repeat(20)), "nothing but a key gets into the PHP");
});
