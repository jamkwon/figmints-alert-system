import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckHistoryTable } from "@/components/check-history-table";
import { IncidentControls } from "@/components/incident-controls";
import { IncidentStatusBadge, SeverityBadge, TeamLabel } from "@/components/status";
import { Panel, PageHeader, When } from "@/components/ui";
import { getAppData, getCheckHistory, getIncidentEvents, type IncidentView } from "@/lib/data";
import { displayUrl, formatDateTime, formatDuration } from "@/lib/format";
import { isUnresolvedIncident } from "@/lib/health";
import { ENVIRONMENT_LABELS, MONITOR_TYPE_LABELS } from "@/lib/labels";

const RECENT_CHECKS = 15;

async function findIncident(id: string): Promise<IncidentView | undefined> {
  const { incidents } = await getAppData();
  return incidents.find((i) => i.incident.id === id);
}

export async function generateMetadata({ params }: PageProps<"/incidents/[id]">): Promise<Metadata> {
  const view = await findIncident((await params).id);
  return { title: view ? `${view.incident.title} · ${view.client.name}` : "Incident not found" };
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="break-words text-fig-ink">{children}</dd>
    </div>
  );
}

export default async function IncidentDetailPage({ params }: PageProps<"/incidents/[id]">) {
  const view = await findIncident((await params).id);
  if (!view) notFound();

  const { incident, client, website, monitor } = view;
  const [history, data, events] = await Promise.all([
    monitor ? getCheckHistory(monitor.id, RECENT_CHECKS) : Promise.resolve([]),
    getAppData(),
    getIncidentEvents(incident.id),
  ]);
  const closed = !isUnresolvedIncident(incident);
  // The most recent failing check's error is the most useful clue.
  const relevantError = history.find((c) => !c.passed)?.error_message ?? null;

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/incidents" className="text-slate-500 hover:text-fig-plum">
          ← Incidents
        </Link>
      </div>
      <PageHeader
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            <Link href={`/clients/${client.id}`} className="font-medium text-fig-plum hover:underline">
              {client.name}
            </Link>
            {monitor && (
              <>
                <span className="text-slate-400">·</span>
                <Link href={`/monitors/${monitor.id}`} className="text-fig-plum hover:underline">
                  {monitor.name}
                </Link>
              </>
            )}
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <Stat label="First detected">
          <When iso={incident.first_detected_at} />
        </Stat>
        <Stat label="Last detected">
          <When iso={incident.last_detected_at} />
        </Stat>
        <Stat label={incident.resolved_at ? "Closed" : "Duration so far"}>
          {incident.resolved_at ? (
            <>
              <When iso={incident.resolved_at} />
              <span className="text-xs text-slate-500">
                after {formatDuration(incident.first_detected_at, incident.resolved_at)}
              </span>
            </>
          ) : (
            <span className="font-medium">{formatDuration(incident.first_detected_at, new Date().toISOString())}</span>
          )}
        </Stat>
        <Stat label="Assigned team">
          <TeamLabel team={incident.assigned_team} />
        </Stat>
      </div>

      <div className="mb-6 grid grid-cols-[3fr_2fr] items-start gap-6">
        <Panel title="Details">
          <dl>
            {incident.status === "snoozed" && incident.snoozed_until && (
              <DetailRow label="Snoozed until">
                {formatDateTime(incident.snoozed_until)}{" "}
                <span className="text-slate-500">(reopens automatically)</span>
              </DetailRow>
            )}
            <DetailRow label="Description">
              {incident.description || <span className="text-slate-400">None</span>}
            </DetailRow>
            <DetailRow label="Relevant error">
              {relevantError ? (
                <span className="text-red-700">{relevantError}</span>
              ) : (
                <span className="text-slate-400">None recorded</span>
              )}
            </DetailRow>
            <DetailRow label="Client">
              <Link href={`/clients/${client.id}`} className="text-fig-plum hover:underline">
                {client.name}
              </Link>
            </DetailRow>
            <DetailRow label="Website">
              {website ? (
                `${displayUrl(website.url)} · ${ENVIRONMENT_LABELS[website.environment]}`
              ) : (
                <span className="text-slate-400">Not linked</span>
              )}
            </DetailRow>
            <DetailRow label="Monitor">
              {monitor ? (
                <>
                  <Link href={`/monitors/${monitor.id}`} className="text-fig-plum hover:underline">
                    {monitor.name}
                  </Link>{" "}
                  <span className="text-slate-500">
                    · {MONITOR_TYPE_LABELS[monitor.monitor_type]} · {displayUrl(monitor.target_url)}
                  </span>
                </>
              ) : (
                <span className="text-slate-400">Not linked</span>
              )}
            </DetailRow>
          </dl>
        </Panel>

        <Panel title="Actions">
          <IncidentControls
            incidentId={incident.id}
            status={incident.status}
            closed={closed}
            team={incident.assigned_team}
            notes={incident.internal_notes}
            disabledReason={
              data.source === "sample" ? "Showing sample data. Connect Supabase to update incidents." : undefined
            }
          />
        </Panel>
      </div>

      <Panel title="History" aside={`${events.length} event${events.length === 1 ? "" : "s"}`} className="mb-6">
        {events.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No history recorded yet.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {events.map((event) => (
              <li key={event.id} className="flex gap-4 px-4 py-2.5 text-sm">
                <div className="w-36 shrink-0">
                  <When iso={event.created_at} />
                </div>
                <div>
                  <div className="text-fig-ink">{event.message}</div>
                  <div className="text-xs text-slate-500">
                    {event.actor === "system" ? "Website Watch (automatic)" : event.actor}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {monitor && (
        <Panel title="Recent checks for this monitor" aside={`Latest ${history.length}`}>
          <CheckHistoryTable checks={history} monitorType={monitor.monitor_type} />
        </Panel>
      )}
    </>
  );
}
