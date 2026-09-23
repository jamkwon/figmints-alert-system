import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IncidentTable } from "@/components/incident-table";
import { MonitorTable } from "@/components/monitor-table";
import { HealthBadge, HealthDot } from "@/components/status";
import { Panel, PageHeader, When } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { displayUrl } from "@/lib/format";
import { ENVIRONMENT_LABELS } from "@/lib/labels";

async function findClient(id: string) {
  const { clients } = await getAppData();
  return clients.find((c) => c.client.id === id);
}

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const view = await findClient((await params).id);
  return { title: view?.client.name ?? "Client not found" };
}

const RECENT_INCIDENT_LIMIT = 10;

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const view = await findClient((await params).id);
  if (!view) notFound();

  const { client, health, websites, monitors, incidents, activeIncidents, lastCheckedAt } = view;

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
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-600">Overall health</div>
          <div className="mt-2">
            <HealthBadge health={health} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-600">Last check</div>
          <div className="mt-1 text-sm">
            <When iso={lastCheckedAt} />
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-600">Open incidents</div>
          <div className="mt-1 font-display text-2xl font-bold text-fig-ink">{activeIncidents.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
          <div className="text-sm text-slate-600">Websites</div>
          <ul className="mt-1 space-y-1 text-sm">
            {websites.map(({ website, health: websiteHealth }) => (
              <li key={website.id} className="flex items-center gap-2">
                <HealthDot health={websiteHealth} />
                <span className="truncate">{displayUrl(website.url)}</span>
                <span className="text-xs text-slate-500">{ENVIRONMENT_LABELS[website.environment]}</span>
              </li>
            ))}
            {websites.length === 0 && <li className="text-slate-400">None</li>}
          </ul>
        </div>
      </div>

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

      <Panel title="Internal notes">
        <p className="px-4 py-4 text-sm whitespace-pre-wrap text-fig-ink-light">
          {client.notes || <span className="text-slate-400">No notes.</span>}
        </p>
      </Panel>
    </>
  );
}
