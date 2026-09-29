import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEmail, isStaff, parseAllowedDomains, safeNextPath, authModeFor, trustedOrigin } from "./allowed.ts";

const domains = ["figmints.com"];

test("allowed domains default to figmints.com and are normalized", () => {
  assert.deepEqual(parseAllowedDomains(undefined), ["figmints.com"]);
  assert.deepEqual(parseAllowedDomains(""), ["figmints.com"]);
  assert.deepEqual(parseAllowedDomains(" Figmints.com, @other.org "), ["figmints.com", "other.org"]);
});

test("only exact allowed domains pass", () => {
  assert.equal(isAllowedEmail("jane@figmints.com", domains), true);
  assert.equal(isAllowedEmail("Jane@FIGMINTS.COM", domains), true);
  assert.equal(isAllowedEmail("jane@gmail.com", domains), false);
  assert.equal(isAllowedEmail("jane@notfigmints.com", domains), false);
  assert.equal(isAllowedEmail("jane@figmints.com.evil.com", domains), false);
  assert.equal(isAllowedEmail("jane@sub.figmints.com", domains), false);
  assert.equal(isAllowedEmail("figmints.com", domains), false);
  assert.equal(isAllowedEmail(undefined, domains), false);
});

test("staff must sign in with Google and an allowed email", () => {
  assert.equal(isStaff({ email: "jane@figmints.com", app_metadata: { provider: "google", providers: ["google"] } }, domains), true);
  assert.equal(isStaff({ email: "jane@figmints.com", app_metadata: { provider: "email", providers: ["email"] } }, domains), false);
  assert.equal(isStaff({ email: "jane@gmail.com", app_metadata: { provider: "google" } }, domains), false);
  assert.equal(isStaff({ email: "jane@figmints.com" }, domains), false);
  assert.equal(isStaff(null, domains), false);
});

test("post-login redirects stay on this site", () => {
  assert.equal(safeNextPath("/incidents?view=all"), "/incidents?view=all");
  assert.equal(safeNextPath("https://evil.com"), "/");
  assert.equal(safeNextPath("//evil.com"), "/");
  assert.equal(safeNextPath("/\\evil.com"), "/");
  assert.equal(safeNextPath(undefined), "/");
});

test("staff accounts must have been created with Google, not just have it linked", () => {
  const domains = ["figmints.com"];
  assert.equal(isStaff({ email: "jane@figmints.com", app_metadata: { provider: "google", providers: ["google", "email"] } }, domains), true);
  assert.equal(
    isStaff({ email: "jane@figmints.com", app_metadata: { provider: "email", providers: ["email", "google"] } }, domains),
    false,
    "an email/password account with a Google identity linked later",
  );
});

test("post-login redirects refuse tricks browsers turn into other sites", () => {
  for (const bad of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\\evil.com", "//evil.com", "/%09/evil.com/..", "https://evil.com", "evil.com"]) {
    const next = safeNextPath(bad);
    assert.equal(new URL(next, "https://watch.example").origin, "https://watch.example", JSON.stringify(bad));
  }
  assert.equal(safeNextPath("/\t/evil.com"), "/");
  assert.equal(safeNextPath("/clients/abc?month=2026-09#top"), "/clients/abc?month=2026-09#top");
  assert.equal(safeNextPath("/clients/../settings"), "/settings", "normalized, still on this site");
});

test("login is only off when there's no Supabase at all, and never on Vercel", () => {
  const all = { url: true, secretKey: true, publicKey: true, onVercel: true };
  assert.equal(authModeFor(all), "required");
  assert.equal(authModeFor({ ...all, secretKey: false }), "misconfigured", "a missing secret key locks, it doesn't open up");
  assert.equal(authModeFor({ ...all, publicKey: false }), "misconfigured");
  assert.equal(authModeFor({ url: false, secretKey: false, publicKey: false, onVercel: true }), "misconfigured");
  assert.equal(authModeFor({ url: false, secretKey: false, publicKey: false, onVercel: false }), "disabled", "local sample data");
  assert.equal(authModeFor({ url: true, secretKey: false, publicKey: false, onVercel: false }), "misconfigured");
});

test("the sign-in return address must be one of the app's own", () => {
  const known = ["https://watch.figmints.com", "figmints-alert-system-git-x.vercel.app"];
  assert.equal(trustedOrigin("https://watch.figmints.com", known, "https://watch.figmints.com"), "https://watch.figmints.com");
  assert.equal(trustedOrigin("https://figmints-alert-system-git-x.vercel.app", known, null), "https://figmints-alert-system-git-x.vercel.app");
  assert.equal(trustedOrigin("http://localhost:3000", known, null), "http://localhost:3000");
  assert.equal(trustedOrigin("https://evil.example", known, "https://watch.figmints.com"), "https://watch.figmints.com");
  assert.equal(trustedOrigin("http://watch.figmints.com", known, null), null, "https only, except localhost");
  assert.equal(trustedOrigin(null, known, "https://watch.figmints.com"), "https://watch.figmints.com");
});
