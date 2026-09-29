import { test } from "node:test";
import assert from "node:assert/strict";
import { UnsafeUrlError, isBlockedAddress, validateTargetUrl } from "./url-safety.ts";

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("private, loopback, link-local and reserved addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("non-IP strings are treated as blocked", () => {
  assert.equal(isBlockedAddress("example.com"), true);
});

test("valid public http(s) URLs pass validation", () => {
  assert.equal(validateTargetUrl("https://example.com/contact").hostname, "example.com");
  assert.equal(validateTargetUrl("http://example.com:8080/").port, "8080");
  assert.equal(validateTargetUrl("https://93.184.216.34/").hostname, "93.184.216.34");
});

function assertRejected(url: string, reason: RegExp) {
  assert.throws(() => validateTargetUrl(url), (err: unknown) => {
    assert.ok(err instanceof UnsafeUrlError, `${url} should throw UnsafeUrlError`);
    assert.match(err.message, reason, url);
    return true;
  });
}

test("unsafe URLs are rejected with a reason", () => {
  assertRejected("not a url", /valid URL/);
  assertRejected("ftp://example.com/", /http and https/);
  assertRejected("file:///etc/passwd", /http and https/);
  assertRejected("https://user:pass@example.com/", /credentials/);
  assertRejected("https://example.com:22/", /Port 22/);
  assertRejected("http://localhost/", /Internal hostnames/);
  assertRejected("http://intranet/", /Internal hostnames/);
  assertRejected("http://printer.local/", /Internal hostnames/);
  assertRejected("http://127.0.0.1/", /Private or reserved/);
  assertRejected("http://169.254.169.254/latest/meta-data/", /Private or reserved/);
  assertRejected("http://[::1]/", /Private or reserved/);
  // Decimal and short forms are normalized by the URL parser before checking
  assertRejected("http://2130706433/", /Private or reserved/);
  assertRejected("http://127.1/", /Private or reserved/);
});

test("more IPv6 ranges and trailing-dot hosts are refused, public addresses still pass", async () => {
  const { isBlockedAddress: blocked, validateTargetUrl: validate } = await import("./url-safety.ts");
  for (const ip of ["2002:a9fe:a9fe::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "::a9fe:a9fe", "::7f00:1", "fec0::1"]) {
    assert.equal(blocked(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(blocked(ip), false, ip);
  }
  assert.equal(blocked("::ffff:127.0.0.1"), true, "IPv4-mapped internal still blocked");
  assert.throws(() => validate("http://localhost./"));
  assert.throws(() => validate("http://metadata.google.internal./"));
});
