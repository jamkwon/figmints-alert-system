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
 * Staff = signed in with Google (which verifies the email) using an allowed domain.
 * Requiring Google stops anyone from signing up with an email/password account
 * using an address they don't control.
 */
export function isStaff(claims: StaffClaims | null | undefined, domains: string[]): boolean {
  if (!claims) return false;
  const meta = claims.app_metadata ?? {};
  const providers = Array.isArray(meta.providers) ? meta.providers : [meta.provider];
  return providers.includes("google") && isAllowedEmail(claims.email, domains);
}

/** Remembers where to send someone after the Google round-trip. */
export const NEXT_PATH_COOKIE = "ww_next";

/** Only allow same-site relative paths after login (no open redirects). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
