import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only: uses the secret (service role) key, which bypasses RLS.
// Never import this from a client component or expose these env vars with NEXT_PUBLIC_.

export function supabaseEnvStatus() {
  return {
    url: Boolean(process.env.SUPABASE_URL),
    secretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
  };
}

export function isSupabaseConfigured(): boolean {
  const status = supabaseEnvStatus();
  return status.url && status.secretKey;
}

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
