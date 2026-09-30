import { MIN_SECRET_LENGTH, isCronAuthorized, isCronSecretSet } from "@/lib/cron-auth";
import { refreshVulnerabilityFeed } from "@/lib/monitoring/vulnerability-feed";
import { isSupabaseConfigured } from "@/lib/supabase/server";

// Downloads the Wordfence vulnerability feed. Called once a day by Supabase
// pg_cron (see supabase/setup/schedule-vulnerabilities.sql). Requires
// `Authorization: Bearer <CRON_SECRET>`. The feed is 100+ MB, hence the long limit.
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  if (!isCronSecretSet()) {
    return Response.json({ error: `CRON_SECRET is not set (min ${MIN_SECRET_LENGTH} characters)` }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  try {
    const summary = await refreshVulnerabilityFeed();
    console.log("[vulnerabilities]", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    console.error("[vulnerabilities] refresh failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
