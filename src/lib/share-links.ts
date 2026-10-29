// Client links: /share/<token> opens one client's report, after its password,
// without a staff login. Pure (no server imports) so tests can run it directly.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url: 43 characters, impossible to guess. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Rejects anything that can't be a token before it reaches the database. */
export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function sharePath(token: string): string {
  return `/share/${token}`;
}

// Passwords ---------------------------------------------------------------------------

// 32 characters that are hard to mix up when read out or typed (no 0/O, 1/I).
// 32 divides 256, so every character is equally likely.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_LENGTH = 12;

/** "K7QM-4PXA-9TRD": 12 characters from 32, 60 bits. */
export function newSharePassword(): string {
  const bytes = randomBytes(PASSWORD_LENGTH);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Case, spaces and dashes don't matter when the client types it. */
export function normalizePassword(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(normalizePassword(password), salt, KEY_LENGTH, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** "scrypt$<salt>$<key>", base64url. */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function verifySharePassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key || !normalizePassword(password)) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Remembering an unlocked link --------------------------------------------------------

/** Set on /share/<token> only, so it unlocks that one link. */
export const SHARE_COOKIE = "ww_share";
export const SHARE_COOKIE_DAYS = 30;

/**
 * The cookie value that proves the password was entered on this device. Keyed by
 * the password hash, which never leaves the server: it can't be forged from the
 * link, and a new password signs everyone out.
 */
export function unlockValue(token: string, passwordHash: string): string {
  return createHmac("sha256", passwordHash).update(token).digest("base64url");
}

export function isUnlocked(cookie: string | undefined, token: string, passwordHash: string): boolean {
  if (!cookie) return false;
  const expected = Buffer.from(unlockValue(token, passwordHash));
  const actual = Buffer.from(cookie);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Guessing ----------------------------------------------------------------------------

export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;

/** What a wrong password does: count it, and lock the link after too many. */
export function afterFailedAttempt(failedAttempts: number, now: Date): { failed_attempts: number; locked_until: string | null } {
  const count = failedAttempts + 1;
  return count >= MAX_FAILED_ATTEMPTS
    ? { failed_attempts: 0, locked_until: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() }
    : { failed_attempts: count, locked_until: null };
}
