import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  nameFromUrl,
  parseBulkLines,
  parseInterval,
  parseOptionalInt,
  parseUrl,
  resolveMonitorUrl,
} from "./validation.ts";

const site = "https://www.figmints.com/";

function rejects(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (err: unknown) => err instanceof ValidationError && pattern.test(err.message));
}

test("URLs get https:// added and must be public", () => {
  assert.equal(parseUrl("www.figmints.com"), "https://www.figmints.com/");
  assert.equal(parseUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(parseUrl("", "url", false), null);
  rejects(() => parseUrl(""), /required/);
  rejects(() => parseUrl("http://localhost/"), /Internal hostnames/);
  rejects(() => parseUrl("http://example.com:3000/"), /Port 3000/);
  rejects(() => parseUrl("http://192.168.1.10/"), /Private or reserved/);
  rejects(() => parseUrl("ftp://example.com"), /http and https/);
});

test("monitor targets can be paths on the website or full URLs", () => {
  assert.equal(resolveMonitorUrl(site, "/contact/"), "https://www.figmints.com/contact/");
  assert.equal(resolveMonitorUrl("https://www.figmints.com/blog/", "/contact"), "https://www.figmints.com/contact");
  assert.equal(resolveMonitorUrl(site, "https://example.com/x"), "https://example.com/x");
  rejects(() => resolveMonitorUrl(site, "  "), /required/);
});

test("intervals and numbers are limited to allowed values", () => {
  assert.equal(parseInterval("15"), 15);
  rejects(() => parseInterval("7"), /interval/);
  assert.equal(parseOptionalInt("", "x", "X", 1, 10), null);
  assert.equal(parseOptionalInt("5", "x", "X", 1, 10), 5);
  rejects(() => parseOptionalInt("11", "x", "X", 1, 10), /1 to 10/);
  rejects(() => parseOptionalInt("2.5", "x", "X", 1, 10), /whole number/);
});

test("bulk lines become monitors with names and optional expected text", () => {
  const lines = parseBulkLines(site, "/\n/contact/ | Discover Your Path\n\n/free-estimate\nhttps://example.com/shop");
  assert.deepEqual(lines, [
    { name: "Homepage", target_url: "https://www.figmints.com/", expected_text: null },
    { name: "Contact Page", target_url: "https://www.figmints.com/contact/", expected_text: "Discover Your Path" },
    { name: "Free Estimate Page", target_url: "https://www.figmints.com/free-estimate", expected_text: null },
    { name: "Shop Page", target_url: "https://example.com/shop", expected_text: null },
  ]);
});

test("bulk lines reject duplicates and unsafe URLs with the line number", () => {
  rejects(() => parseBulkLines(site, "/contact\n/contact"), /Line 2: .* listed twice/);
  rejects(() => parseBulkLines(site, "/ok\nhttp://127.0.0.1/"), /Line 2: Private or reserved/);
});

test("names are derived from the URL path", () => {
  assert.equal(nameFromUrl("https://a.com/"), "Homepage");
  assert.equal(nameFromUrl("https://a.com/about-us/"), "About Us Page");
  assert.equal(nameFromUrl("https://a.com/files/brochure.pdf"), "Brochure Page");
});
