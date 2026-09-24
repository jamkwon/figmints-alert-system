import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { IncidentTable } from "@/components/incident-table";
import { MaintenanceControl } from "@/components/maintenance-control";
import { MonitorTable } from "@/components/monitor-table";
import { HealthBadge, HealthDot } from "@/components/status";
import { EmptyState, LinkButton, Panel, PageHeader, When } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { displayUrl, formatDateTime, formatUptime, isInFuture } from "@/lib/format";
import { ENVIRONMENT_LABELS } from "@/lib/labels";

async function findClient(id: string) {
  const data = await getAppData();
  return { view: data.clients.find((c) => c.client.id === id), sampleMode: data.source === "sample" };
}

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { view } = await findClient((await params).id);
  return { title: view?.client.name ?? "Client not found" };
}

// Run check can start a broken link scan, which takes up to ~40 seconds.
export const maxDuration = 60;

const RECENT_INCIDENT_LIMIT = 10;

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { view, sampleMode } = await findClient((await params).id);
  if (!view) notFound();

  const { client, health, websites, monitors, incidents, activeIncidents, lastCheckedAt, uptime7d } = view;
  const uptime = formatUptime(uptime7d.passed, uptime7d.checks);
  const disabledReason = sampleMode ? "Connect Supabase to make changes" : undefined;

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/clients" className="text-slate-500 hover:text-fig-plum">
          ← Clients
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {client.name}
            <HealthBadge health={health} />
          </span>
        }
        description={
          client.primary_website && (
            <a
              href={client.primary_website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fig-plum hover:underline"
            >
              {displayUrl(client.primary_website)} ↗
            </a>
          )
        }
        actions={
          <>
            <LinkButton href={`/clients/${client.id}/edit`}>Edit client</LinkButton>
            <LinkButton href={`/clients/${client.id}/websites/new`}>Add website</LinkButton>
            <LinkButton href={`/clients/${client.id}/monitors/new`} primary>
              Add monitors
            </LinkButton>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <StatCard label="Overall health">
          <div className="mt-1">
            <HealthBadge health={health} />
          </div>
        </StatCard>
        <StatCard label="Last check">
          <div className="text-sm">
            <When iso={lastCheckedAt} />
          </div>
        </StatCard>
        <StatCard label="Open incidents">
          <div className="font-display text-2xl font-bold text-fig-ink">{activeIncidents.length}</div>
        </StatCard>
        <StatCard label="Uptime (7 days)">
          <div className="font-display text-2xl font-bold text-fig-ink">
            {uptime ?? <span className="text-base font-normal text-slate-400">No checks yet</span>}
          </div>
          {uptime && <div className="text-xs text-slate-500">{uptime7d.checks} checks</div>}
        </StatCard>
      </div>

      <Panel title="Websites" aside={`${websites.length} total`} className="mb-6">
        {websites.length === 0 ? (
          <EmptyState>
            No websites yet.{" "}
            <Link href={`/clients/${client.id}/websites/new`} className="text-fig-plum hover:underline">
              Add one
            </Link>
            .
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {websites.map(({ website, health: websiteHealth }) => {
              const inMaintenance = isInFuture(website.maintenance_until);
              return (
                <li key={website.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <HealthDot health={websiteHealth} />
                  <div className="min-w-48 flex-1">
                    <div className="font-medium text-fig-ink">
                      {website.name}{" "}
                      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                        {ENVIRONMENT_LABELS[website.environment]}
                      </span>
                      {!website.active && <span className="ml-2 text-xs text-slate-500">(inactive)</span>}
                    </div>
                    <a
                      href={website.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-500 hover:text-fig-plum hover:underline"
                    >
                      {displayUrl(website.url)}
                    </a>
                    {inMaintenance && (
                      <div className="mt-1 text-xs text-amber-800">
                        In maintenance until {formatDateTime(website.maintenance_until!)}
                        {website.maintenance_note && <> · {website.maintenance_note}</>}. New incidents are
                        marked Expected Maintenance.
                      </div>
                    )}
                  </div>
                  <MaintenanceControl
                    websiteId={website.id}
                    inMaintenance={inMaintenance}
                    disabledReason={disabledReason}
                  />
                  <Link
                    href={`/clients/${client.id}/monitors/new?website=${website.id}`}
                    className="text-xs text-fig-plum hover:underline"
                  >
                    Add monitors
                  </Link>
                  <Link href={`/websites/${website.id}/edit`} className="text-xs text-fig-plum hover:underline">
                    Edit
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Monitors" aside={`${monitors.length} total`} className="mb-6">
        <MonitorTable monitors={monitors} showClient={false} />
      </Panel>

      <Panel
        title="Recent incidents"
        aside={incidents.length > RECENT_INCIDENT_LIMIT ? `Latest ${RECENT_INCIDENT_LIMIT} of ${incidents.length}` : undefined}
        className="mb-6"
      >
        <IncidentTable
          incidents={incidents.slice(0, RECENT_INCIDENT_LIMIT)}
          showClient={false}
          emptyMessage="No incidents recorded for this client."
        />
      </Panel>

      <Panel title="Internal notes" aside={<Link href={`/clients/${client.id}/edit`} className="text-fig-plum hover:underline">Edit</Link>}>
        <p className="px-4 py-4 text-sm whitespace-pre-wrap text-fig-ink-light">
          {client.notes || <span className="text-slate-400">No notes.</span>}
        </p>
      </Panel>
    </>
  );
}
