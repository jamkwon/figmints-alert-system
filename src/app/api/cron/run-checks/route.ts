import { timingSafeEqual } from "node:crypto";
import { runDueChecks } from "@/lib/monitoring/scheduler";
import { isSupabaseConfigured } from "@/lib/supabase/server";

// Scheduled entry point. Called every 5 minutes by Supabase pg_cron (see
// supabase/setup/schedule-checks.sql). Requires `Authorization: Bearer <CRON_SECRET>`.
export const maxDuration = 60;

const MIN_SECRET_LENGTH = 16;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function handle(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < MIN_SECRET_LENGTH) {
    return Response.json(
      { error: `CRON_SECRET is not set (min ${MIN_SECRET_LENGTH} characters)` },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  }

  try {
    const summary = await runDueChecks();
    console.log("[scheduler]", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scheduler failed";
    console.error("[scheduler] failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
