import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEmail, isStaff, parseAllowedDomains, safeNextPath } from "./allowed.ts";

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
