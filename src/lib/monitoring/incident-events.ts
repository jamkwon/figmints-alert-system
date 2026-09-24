import "server-only";
import { getSupabase } from "@/lib/supabase/server";
import type { IncidentEventKind } from "@/lib/types";

export const SYSTEM_ACTOR = "system";

/**
 * Records one line of incident history. History is informative, not critical:
 * a failure here is logged and never blocks the check or action that caused it.
 */
export async function logIncidentEvent(
  incidentId: string,
  actor: string,
  kind: IncidentEventKind,
  message: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("incident_events")
    .insert({ incident_id: incidentId, actor, kind, message });
  if (error) console.error(`[incident-events] could not record ${kind} for ${incidentId}: ${error.message}`);
}
