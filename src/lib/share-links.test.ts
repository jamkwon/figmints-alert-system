import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  afterFailedAttempt,
  hashSharePassword,
  isShareToken,
  isUnlocked,
  newSharePassword,
  newShareToken,
  normalizePassword,
  sharePath,
  unlockValue,
  verifySharePassword,
} from "./share-links.ts";

test("newShareToken: 43 URL-safe characters, different every time", () => {
  const a = newShareToken();
  const b = newShareToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.ok(isShareToken(a));
});

test("isShareToken: only well-formed tokens", () => {
  assert.equal(isShareToken("a".repeat(43)), true);
  assert.equal(isShareToken("a".repeat(42)), false);
  assert.equal(isShareToken("a".repeat(44)), false);
  assert.equal(isShareToken(`${"a".repeat(42)}/`), false);
  assert.equal(isShareToken(`${"a".repeat(42)}=`), false);
  assert.equal(isShareToken("' or 1=1 --"), false);
  assert.equal(isShareToken(undefined), false);
  assert.equal(isShareToken(["a".repeat(43)]), false);
});

test("sharePath", () => {
  assert.equal(sharePath("abc"), "/share/abc");
});

test("newSharePassword: three groups of four, no look-alike characters", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = newSharePassword();
    assert.match(p, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test("normalizePassword: case, spaces and dashes don't matter", () => {
  assert.equal(normalizePassword(" k7qm-4pxa 9trd "), "K7QM4PXA9TRD");
});

test("hashSharePassword / verifySharePassword", async () => {
  const hash = await hashSharePassword("K7QM-4PXA-9TRD");
  assert.match(hash, /^scrypt\$[\w-]+\$[\w-]+$/);
  assert.notEqual(hash, await hashSharePassword("K7QM-4PXA-9TRD"), "salted");
  assert.equal(await verifySharePassword("K7QM-4PXA-9TRD", hash), true);
  assert.equal(await verifySharePassword("k7qm 4pxa 9trd", hash), true, "typed loosely");
  assert.equal(await verifySharePassword("K7QM-4PXA-9TRE", hash), false);
  assert.equal(await verifySharePassword("", hash), false);
  assert.equal(await verifySharePassword("---", hash), false);
  assert.equal(await verifySharePassword("K7QM-4PXA-9TRD", "plain"), false);
  assert.equal(await verifySharePassword("K7QM-4PXA-9TRD", "scrypt$$"), false);
});

test("unlock cookie: tied to the link and the current password", () => {
  const token = "a".repeat(43);
  const value = unlockValue(token, "hash-1");
  assert.equal(isUnlocked(value, token, "hash-1"), true);
  assert.equal(isUnlocked(value, "b".repeat(43), "hash-1"), false, "another link");
  assert.equal(isUnlocked(value, token, "hash-2"), false, "password changed");
  assert.equal(isUnlocked(undefined, token, "hash-1"), false);
  assert.equal(isUnlocked("", token, "hash-1"), false);
  assert.equal(isUnlocked(value.slice(1), token, "hash-1"), false);
});

test("afterFailedAttempt: locks after too many wrong passwords", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.deepEqual(afterFailedAttempt(0, now), { failed_attempts: 1, locked_until: null });
  assert.deepEqual(afterFailedAttempt(MAX_FAILED_ATTEMPTS - 2, now), { failed_attempts: MAX_FAILED_ATTEMPTS - 1, locked_until: null });
  assert.deepEqual(afterFailedAttempt(MAX_FAILED_ATTEMPTS - 1, now), {
    failed_attempts: 0,
    locked_until: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(),
  });
});
