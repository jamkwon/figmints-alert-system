import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLinks, extractLinks, judgeLink, reasonFor } from "./links.ts";

const page = "https://www.example.com/about/";

test("extracts links, images, stylesheets and scripts as absolute URLs", () => {
  const html = `
    <link rel="stylesheet" href="/css/site.css">
    <link rel="icon" href="/favicon.ico">
    <script src="https://cdn.other.com/app.js"></script>
    <a href="contact">Contact <b>us</b></a>
    <a href='/team#jane'>Team</a>
    <img src="../img/logo.png" alt="Logo">`;
  const { links, total } = extractLinks(html, page);
  assert.equal(total, 5);
  assert.deepEqual(
    links.map((l) => [l.kind, l.url, l.text]),
    [
      ["link", "https://www.example.com/about/contact", "Contact us"],
      ["link", "https://www.example.com/team", "Team"],
      ["image", "https://www.example.com/img/logo.png", "Logo"],
      ["stylesheet", "https://www.example.com/css/site.css", null],
      ["script", "https://cdn.other.com/app.js", null],
    ],
  );
});

test("skips anchors, mailto, tel, javascript, data, duplicates and the page itself", () => {
  const html = `
    <a href="#top">Top</a><a href="mailto:a@b.com">Mail</a><a href="tel:123">Call</a>
    <a href="javascript:void(0)">JS</a><img src="data:image/png;base64,xx">
    <a href="/about/">Self</a><a href="/x">X</a><a href="/x#y">X again</a>`;
  const { links } = extractLinks(html, page);
  assert.deepEqual(links.map((l) => l.url), ["https://www.example.com/x"]);
});

test("same-site links come first and the list is capped", () => {
  const html = `<a href="https://other.com/a">A</a><a href="/b">B</a><a href="/c">C</a>`;
  const { links, total } = extractLinks(html, page, 2);
  assert.equal(total, 3);
  assert.deepEqual(links.map((l) => l.url), ["https://www.example.com/b", "https://www.example.com/c"]);
});

test("honors <base href>", () => {
  const { links } = extractLinks(`<base href="https://cdn.example.com/v2/"><img src="pic.jpg">`, page);
  assert.equal(links[0].url, "https://cdn.example.com/v2/pic.jpg");
});

test("only clear failures count as broken", () => {
  assert.equal(judgeLink({ status: 200, error: null }), "ok");
  assert.equal(judgeLink({ status: 301, error: null }), "ok");
  assert.equal(judgeLink({ status: 404, error: null }), "broken");
  assert.equal(judgeLink({ status: 410, error: null }), "broken");
  assert.equal(judgeLink({ status: 503, error: null }), "broken");
  assert.equal(judgeLink({ status: 403, error: null }), "unknown");
  assert.equal(judgeLink({ status: 429, error: null }), "unknown");
  assert.equal(judgeLink({ status: 999, error: null }), "unknown");
  assert.equal(judgeLink({ status: null, error: { code: "ENOTFOUND", message: "x" } }), "broken");
  assert.equal(judgeLink({ status: null, error: { code: "ECONNREFUSED", message: "x" } }), "broken");
  assert.equal(judgeLink({ status: null, error: { code: "UND_ERR_CONNECT_TIMEOUT", message: "x" } }), "unknown");
  assert.equal(reasonFor({ status: 404, error: null }), "HTTP 404");
  assert.equal(reasonFor({ status: null, error: { code: "ENOTFOUND", message: "x" } }), "Domain not found");
});

test("broken links make a warning with a short summary", () => {
  assert.equal(evaluateLinks(page, 10, [], 900, 200).status, "passed");
  const broken = [
    { url: "https://www.example.com/old", kind: "link" as const, text: "Old", reason: "HTTP 404" },
    { url: "https://gone.com/x", kind: "link" as const, text: null, reason: "Domain not found" },
    { url: "https://www.example.com/a.png", kind: "image" as const, text: null, reason: "HTTP 404" },
    { url: "https://www.example.com/b", kind: "link" as const, text: null, reason: "HTTP 500" },
  ];
  const outcome = evaluateLinks(page, 38, broken, 5200.4, 200);
  assert.equal(outcome.status, "warning");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.http_status, 200);
  assert.equal(
    outcome.error_message,
    "4 broken links of 38 checked: /old (HTTP 404), gone.com/x (Domain not found), /a.png (HTTP 404) and 1 more",
  );
});

test("odd error codes don't break judging", () => {
  // Some network errors carry a numeric code.
  const numeric = { status: null, error: { code: -3008 as unknown as string, message: "x" } };
  assert.equal(judgeLink(numeric), "unknown");
  assert.equal(reasonFor(numeric), "x");
});
