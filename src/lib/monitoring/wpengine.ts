// WP Engine Hosting Platform API client (read-only: sites, installs and backups).
// Credentials: WPENGINE_API_USER / WPENGINE_API_PASSWORD from my.wpengine.com → API Access.
// Server-side only (reads secrets from the environment); never import from client code.
import { firstSetEnv } from "../supabase/config.ts";
import type { WpeBackup, WpeInstall } from "./wordpress.ts";
import type { WpeSite } from "./wpengine-import.ts";

const API = "https://api.wpengineapi.com/v1";
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// One scheduler run checks many sites; list installs once, not per site.
const INSTALLS_TTL_MS = 10 * 60_000;

function credentials(): { user: string; password: string } | null {
  const user = firstSetEnv(["WPENGINE_API_USER"])?.value;
  const password = firstSetEnv(["WPENGINE_API_PASSWORD"])?.value;
  return user && password ? { user, password } : null;
}

export function isWpeConfigured(): boolean {
  return credentials() !== null;
}

async function wpeGet(path: string): Promise<Record<string, unknown>> {
  const creds = credentials();
  if (!creds) throw new Error("WP Engine API is not configured");
  const res = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${creds.user}:${creds.password}`).toString("base64")}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new Error("WP Engine rejected the API credentials");
  if (res.status === 429) throw new Error("WP Engine API rate limit reached; will retry next check");
  if (!res.ok) throw new Error(`WP Engine API answered HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Follows limit/offset pagination until a short page or MAX_PAGES. */
async function listAll(path: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await wpeGet(`${path}${sep}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
    const results = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
    all.push(...results);
    if (results.length < PAGE_SIZE || !body.next) break;
  }
  return all;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

let installsCache: { at: number; installs: WpeInstall[] } | null = null;

export async function listInstalls(): Promise<WpeInstall[]> {
  if (installsCache && Date.now() - installsCache.at < INSTALLS_TTL_MS) return installsCache.installs;
  const installs = (await listAll("/installs")).map((i) => ({
    id: String(i.id),
    name: String(i.name ?? ""),
    environment: str(i.environment) ?? "production",
    status: str(i.status) ?? "unknown",
    php_version: str(i.php_version),
    wp_version: str(i.wp_version),
    primary_domain: str(i.primary_domain),
    cname: str(i.cname),
    defer_wordpress_upgrades_until: str(i.defer_wordpress_upgrades_until),
  }));
  installsCache = { at: Date.now(), installs };
  return installs;
}

export async function listBackups(installId: string): Promise<WpeBackup[]> {
  if (!/^[0-9a-f-]{36}$/i.test(installId)) throw new Error("Invalid install id");
  return (await listAll(`/installs/${installId}/backups`)).map((b) => ({
    id: String(b.id),
    status: str(b.status) ?? "unknown",
    create_time: str(b.create_time),
    complete_time: str(b.complete_time),
    wordpress_version: str(b.wordpress_version),
  }));
}

/** Sites group an install per environment; their names suggest client names on import. */
export async function listSites(): Promise<WpeSite[]> {
  return (await listAll("/sites")).map((s) => ({
    id: String(s.id),
    name: String(s.name ?? ""),
    sandbox: s.sandbox === true,
    installIds: Array.isArray(s.installs) ? (s.installs as { id?: unknown }[]).map((i) => String(i.id)) : [],
  }));
}

/** Cheap call for Settings: are the credentials accepted? */
export async function checkWpeConnection(): Promise<{ ok: boolean; message: string }> {
  if (!isWpeConfigured()) return { ok: false, message: "Not configured" };
  try {
    const installs = await listInstalls();
    return { ok: true, message: `Connected · ${installs.length} install${installs.length === 1 ? "" : "s"}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Connection failed" };
  }
}
