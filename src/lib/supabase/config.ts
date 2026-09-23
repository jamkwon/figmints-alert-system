// Supabase settings from the environment. No "server-only" import so the proxy can
// use it too, but it only ever runs on the server: values are read dynamically,
// so NEXT_PUBLIC_ names are never inlined into browser bundles.

// Accepted names, first match wins. The later names are the ones Vercel's
// Supabase Marketplace integration creates.
export const URL_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
export const SECRET_KEY_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
// Public (publishable/anon) key: used only for the login session. RLS stops it
// from reading any table, so it grants no data access on its own.
export const PUBLIC_KEY_VARS = [
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/** `vercel env pull` writes this in place of sensitive values. */
const VERCEL_PLACEHOLDER = "[SENSITIVE]";

export function firstSetEnv(names: readonly string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && value !== VERCEL_PLACEHOLDER) return { name, value };
  }
  return undefined;
}

export function isSupabaseConfigured(): boolean {
  return firstSetEnv(URL_VARS) !== undefined && firstSetEnv(SECRET_KEY_VARS) !== undefined;
}
