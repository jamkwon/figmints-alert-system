import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { HealthBadge } from "@/components/status";
import { Panel, PageHeader } from "@/components/ui";
import { getDataSource } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { supabaseEnvStatus } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[16rem_1fr] gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-fig-ink">{children}</dd>
    </div>
  );
}

function EnvStatus({ set }: { set: boolean }) {
  return set ? <HealthBadge health="healthy" label="Set" /> : <HealthBadge health="unknown" label="Not set" />;
}

export default async function SettingsPage() {
  await connection();
  const source = getDataSource();
  const env = supabaseEnvStatus();

  return (
    <>
      <PageHeader title="Settings" description="Read-only for now. Editable settings come in a later phase." />

      <Panel title="Data source" className="mb-6">
        <dl>
          <Row label="Currently using">
            {source === "supabase" ? (
              <HealthBadge health="healthy" label="Supabase" />
            ) : (
              <HealthBadge health="warning" label="Built-in sample data" />
            )}
          </Row>
          <Row label="SUPABASE_URL">
            <EnvStatus set={env.url} />
          </Row>
          <Row label="SUPABASE_SECRET_KEY">
            <EnvStatus set={env.secretKey} />
          </Row>
        </dl>
        {source === "sample" && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Set both variables in <code>.env.local</code> and restart the server to use Supabase. See the README.
          </p>
        )}
      </Panel>

      <Panel title="Monitoring rules">
        <dl>
          <Row label="Open an incident after">2 consecutive failed checks</Row>
          <Row label="Resolve an incident after">2 consecutive successful checks</Row>
          <Row label="Default HTTP success">Status 200–399 (unless a monitor sets an expected status)</Row>
          <Row label="Display timezone">{APP_TIMEZONE}</Row>
          <Row label="Automated checks">
            <span className="text-slate-500">Not running yet. Checks and scheduling arrive in Phases 2 to 4.</span>
          </Row>
        </dl>
      </Panel>
    </>
  );
}
