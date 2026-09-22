import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only: uses the secret (service role) key, which bypasses RLS.
// Never import this from a client component or expose the key with NEXT_PUBLIC_.

// Accepted names, first match wins. The later names are the ones Vercel's
// Supabase Marketplace integration creates. The project URL is not secret, so
// reading the NEXT_PUBLIC_ variant on the server is fine. The anon/publishable
// key is deliberately never used: RLS blocks it.
const URL_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const SECRET_KEY_VARS = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function firstSet(names: readonly string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return { name, value };
  }
  return undefined;
}

/** Which variable supplied each setting (names only, never values). */
export function supabaseEnvStatus() {
  return {
    url: firstSet(URL_VARS)?.name ?? null,
    secretKey: firstSet(SECRET_KEY_VARS)?.name ?? null,
    urlOptions: URL_VARS,
    secretKeyOptions: SECRET_KEY_VARS,
  };
}

export function isSupabaseConfigured(): boolean {
  const status = supabaseEnvStatus();
  return status.url !== null && status.secretKey !== null;
}

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  const url = firstSet(URL_VARS);
  const key = firstSet(SECRET_KEY_VARS);
  if (!url || !key) {
    throw new Error(
      `Supabase is not configured. Set one of ${URL_VARS.join(" / ")} and one of ${SECRET_KEY_VARS.join(" / ")}.`,
    );
  }
  client ??= createClient(url.value, key.value, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
