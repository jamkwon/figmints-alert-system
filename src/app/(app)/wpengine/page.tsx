import type { Metadata } from "next";
import { connection } from "next/server";
import { EmptyState, LinkButton, Panel, PageHeader } from "@/components/ui";
import { WpeImportForm } from "@/components/wpengine-import-form";
import { getAppData } from "@/lib/data";
import { CHECKS_PER_RUN_ESTIMATE } from "@/lib/monitoring/scheduler";
import { buildCandidates, checksPerDay, type ImportCandidate } from "@/lib/monitoring/wpengine-import";
import { isWpeConfigured, listInstalls, listSites } from "@/lib/monitoring/wpengine";

export const metadata: Metadata = { title: "Import from WP Engine" };

export default async function WpeImportPage({ searchParams }: PageProps<"/wpengine">) {
  await connection();
  const { imported } = await searchParams;
  const { source, clients, monitors } = await getAppData();

  let candidates: ImportCandidate[] | null = null;
  let error: string | null = null;
  if (isWpeConfigured()) {
    try {
      const [installs, sites] = await Promise.all([listInstalls(), listSites()]);
      candidates = buildCandidates(
        installs,
        sites,
        clients.flatMap((c) => c.websites.map((w) => ({ url: w.website.url, clientName: c.client.name }))),
        clients.map((c) => c.client.name),
      );
    } catch (err) {
      error = err instanceof Error ? err.message : "WP Engine API request failed";
    }
  }

  const currentPerDay = checksPerDay(
    monitors
      .filter((m) => m.monitor.active && m.website.active && m.client.active)
      .map((m) => m.monitor.interval_minutes),
  );

  return (
    <>
      <PageHeader
        title="Import from WP Engine"
        description="Add production sites hosted on WP Engine as clients, with checks, in one go."
        actions={<LinkButton href="/clients">Back to clients</LinkButton>}
      />
      {typeof imported === "string" && /^\d+$/.test(imported) && (
        <p role="status" className="mb-6 rounded-md bg-fig-teal/10 px-3 py-2 text-sm text-fig-ink">
          Imported {imported} site{imported === "1" ? "" : "s"}. Their first checks are spread over the next few
          minutes to hours.
        </p>
      )}
      {!isWpeConfigured() ? (
        <Panel>
          <EmptyState>
            Set WPENGINE_API_USER and WPENGINE_API_PASSWORD to import sites (see README → WordPress health).
          </EmptyState>
        </Panel>
      ) : error || !candidates ? (
        <Panel>
          <EmptyState>Couldn&apos;t load sites from WP Engine: {error}</EmptyState>
        </Panel>
      ) : (
        <WpeImportForm
          candidates={candidates}
          currentPerDay={currentPerDay}
          capacityPerDay={{ fiveMinutes: CHECKS_PER_RUN_ESTIMATE * 288, everyMinute: CHECKS_PER_RUN_ESTIMATE * 1440 }}
          disabledReason={source === "sample" ? "Connect Supabase to import sites." : undefined}
        />
      )}
    </>
  );
}
