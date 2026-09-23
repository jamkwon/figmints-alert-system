import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { isStaff, parseAllowedDomains, type StaffClaims } from "@/lib/auth/allowed";
import { PUBLIC_KEY_VARS, URL_VARS, firstSetEnv, isSupabaseConfigured } from "@/lib/supabase/config";

export interface StaffUser {
  email: string;
  name: string | null;
}

export type AuthMode =
  /** No Supabase: the app shows sample data only, so no login is needed. */
  | "disabled"
  /** Supabase is connected: every page and action requires a staff login. */
  | "required"
  /** Supabase is connected but the login key is missing: everything is locked. */
  | "misconfigured";

export function getAuthMode(): AuthMode {
  if (!isSupabaseConfigured()) return "disabled";
  return firstSetEnv(PUBLIC_KEY_VARS) ? "required" : "misconfigured";
}

export function allowedDomains(): string[] {
  return parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
}

/** Supabase client bound to the request's auth cookies (the login session only). */
export async function createAuthClient() {
  const url = firstSetEnv(URL_VARS);
  const key = firstSetEnv(PUBLIC_KEY_VARS);
  if (!url || !key) throw new Error("Login is not configured: set SUPABASE_PUBLISHABLE_KEY.");
  const cookieStore = await cookies();
  return createServerClient(url.value, key.value, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in staff member, or null. Verifies the session token; cached per request. */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  if (getAuthMode() !== "required") return null;
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as (StaffClaims & { user_metadata?: { full_name?: unknown; name?: unknown } }) | undefined;
  if (error || !isStaff(claims, allowedDomains())) return null;
  const meta = claims?.user_metadata ?? {};
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  return { email: String(claims?.email), name };
});

/**
 * Use in every page/data load. Redirects to /login unless the request is from staff.
 * In sample-data mode (no Supabase) there is nothing to protect, so it allows access.
 */
export async function requireStaff(): Promise<StaffUser | null> {
  // Decide per request, never at build time: otherwise a build without the login key
  // would bake a redirect (or an open page) into the static output.
  await connection();
  const mode = getAuthMode();
  if (mode === "disabled") return null;
  if (mode === "misconfigured") redirect("/login?error=config");
  const user = await getStaffUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions: true when the caller may act. Actions return an error instead of redirecting. */
export async function isStaffRequest(): Promise<boolean> {
  await connection();
  const mode = getAuthMode();
  if (mode === "disabled") return true;
  if (mode === "misconfigured") return false;
  return (await getStaffUser()) !== null;
}

export interface StaffProfile extends StaffUser {
  provider: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  sessionExpiresAt: string | null;
}

/** Fuller account details for the profile page (one extra call to Supabase Auth). */
export async function getStaffProfile(): Promise<StaffProfile | null> {
  const user = await requireStaff();
  if (!user) return null;
  const supabase = await createAuthClient();
  const [{ data: userData }, { data: claimsData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getClaims(),
  ]);
  const exp = claimsData?.claims?.exp;
  return {
    ...user,
    provider: userData.user?.app_metadata?.provider ?? "google",
    createdAt: userData.user?.created_at ?? null,
    lastSignInAt: userData.user?.last_sign_in_at ?? null,
    sessionExpiresAt: typeof exp === "number" ? new Date(exp * 1000).toISOString() : null,
  };
}
