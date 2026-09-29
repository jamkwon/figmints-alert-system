// Who may use Website Watch. Pure functions (no imports) so the proxy can use them
// and tests can run them directly.

export const DEFAULT_ALLOWED_DOMAINS = ["figmints.com"];

/** Comma-separated ALLOWED_EMAIL_DOMAINS, e.g. "figmints.com,figmints.co". */
export function parseAllowedDomains(raw: string | undefined): string[] {
  const domains = (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return domains.length > 0 ? domains : DEFAULT_ALLOWED_DOMAINS;
}

export function isAllowedEmail(email: unknown, domains: string[]): boolean {
  if (typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  // Exact match only: "figmints.com.evil.com" and "notfigmints.com" are rejected.
  return domains.includes(domain);
}

/** The JWT claims we rely on (from supabase.auth.getClaims()). */
export interface StaffClaims {
  email?: unknown;
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
}

/**
 * Staff = an account created by signing in with Google (which verifies the email)
 * using an allowed domain. Requiring Google as the account's own provider, not just
 * a linked one, stops someone from signing up with email/password as an address
 * they don't control and then linking their own Google account to it.
 */
export function isStaff(claims: StaffClaims | null | undefined, domains: string[]): boolean {
  if (!claims) return false;
  const meta = claims.app_metadata ?? {};
  return meta.provider === "google" && isAllowedEmail(claims.email, domains);
}

export type AuthMode = "disabled" | "required" | "misconfigured";

/**
 * Login is off (sample data) only when no Supabase setting exists at all and the
 * app isn't running on Vercel. A deployment missing one variable is locked
 * rather than opened up.
 */
export function authModeFor(env: { url: boolean; secretKey: boolean; publicKey: boolean; onVercel: boolean }): AuthMode {
  if (env.url && env.secretKey && env.publicKey) return "required";
  if (!env.url && !env.secretKey && !env.publicKey && !env.onVercel) return "disabled";
  return "misconfigured";
}

/**
 * Where Google should send people back: the request's own origin when it's one
 * of the app's addresses (production, this Vercel deployment, localhost),
 * otherwise the configured app address.
 */
export function trustedOrigin(requestOrigin: string | null, known: (string | null | undefined)[], fallback: string | null): string | null {
  const hosts = new Set(
    known.filter((h): h is string => Boolean(h)).map((h) => h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase()),
  );
  if (requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if ((url.protocol === "https:" && hosts.has(url.host.toLowerCase())) || (local && url.protocol === "http:")) return url.origin;
    } catch {
      // Not a URL: use the fallback.
    }
  }
  return fallback;
}

/** Remembers where to send someone after the Google round-trip. */
export const NEXT_PATH_COOKIE = "ww_next";

/**
 * Only allow same-site relative paths after login (no open redirects). Browsers
 * drop tabs and newlines in URLs, so "/\t/evil.com" would become "//evil.com":
 * control characters and backslashes are refused, and the path must resolve on this site.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  try {
    const base = "https://this.site.invalid";
    const url = new URL(next, base);
    return url.origin === base ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
