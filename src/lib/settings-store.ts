import "server-only";
import { DEFAULT_SETTINGS, settingsFromRow, settingsToRow, type AppSettings } from "@/lib/settings";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/server";

// Checks read the rules on every run; a short cache keeps that to one query
// per server instance per half minute. A saved change applies within that time.
const CACHE_MS = 30_000;
let cache: { at: number; settings: AppSettings } | null = null;

export interface SettingsInfo {
  settings: AppSettings;
  updatedAt: string | null;
  updatedBy: string | null;
  /** False before the migration has run: defaults are used and can't be saved yet. */
  stored: boolean;
}

/** Current settings, including who changed them last. Falls back to defaults. */
export async function getSettingsInfo(): Promise<SettingsInfo> {
  const fallback = { settings: { ...DEFAULT_SETTINGS }, updatedAt: null, updatedBy: null, stored: false };
  if (!isSupabaseConfigured()) return fallback;
  const { data, error } = await getSupabase().from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.warn("[settings] using defaults:", error.message);
    return fallback;
  }
  const row = data as Record<string, unknown>;
  return {
    settings: settingsFromRow(row),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    updatedBy: typeof row.updated_by === "string" ? row.updated_by : null,
    stored: true,
  };
}

/** Settings for checks and the scheduler (cached briefly). */
export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  const { settings } = await getSettingsInfo();
  cache = { at: Date.now(), settings };
  return settings;
}

export async function saveSettings(settings: AppSettings, actor: string): Promise<void> {
  const { error } = await getSupabase()
    .from("app_settings")
    .upsert({ id: 1, ...settingsToRow(settings), updated_at: new Date().toISOString(), updated_by: actor });
  if (error) throw new Error(`Could not save settings: ${error.message}`);
  cache = { at: Date.now(), settings };
}
