import type { Metadata } from "next";
import { MonitorTable } from "@/components/monitor-table";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";
import { compareHealth } from "@/lib/health";

export const metadata: Metadata = { title: "Checks" };

export default async function ChecksPage() {
  const { monitors } = await getAppData();
  const sorted = [...monitors].sort(
    (a, b) =>
      compareHealth(a.health, b.health) ||
      a.client.name.localeCompare(b.client.name) ||
      a.monitor.name.localeCompare(b.monitor.name),
  );

  return (
    <>
      <PageHeader
        title="Checks"
        description="Every configured monitor, its latest result, and when it last worked."
      />
      <Panel>
        <MonitorTable monitors={sorted} />
      </Panel>
    </>
  );
}
