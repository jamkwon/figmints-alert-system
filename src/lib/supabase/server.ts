import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PUBLIC_KEY_VARS,
  SECRET_KEY_VARS,
  URL_VARS,
  firstSetEnv,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

// Server-only: uses the secret (service role) key, which bypasses RLS.
// Never import this from a client component or expose the key with NEXT_PUBLIC_.

export { isSupabaseConfigured };

/** Which variable supplied each setting (names only, never values). */
export function supabaseEnvStatus() {
  return {
    url: firstSetEnv(URL_VARS)?.name ?? null,
    secretKey: firstSetEnv(SECRET_KEY_VARS)?.name ?? null,
    publicKey: firstSetEnv(PUBLIC_KEY_VARS)?.name ?? null,
    urlOptions: URL_VARS,
    secretKeyOptions: SECRET_KEY_VARS,
    publicKeyOptions: PUBLIC_KEY_VARS,
  };
}

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  const url = firstSetEnv(URL_VARS);
  const key = firstSetEnv(SECRET_KEY_VARS);
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
