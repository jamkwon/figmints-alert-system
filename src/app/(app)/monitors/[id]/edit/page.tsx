import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonitorForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Edit monitor" };

export default async function EditMonitorPage({ params }: PageProps<"/monitors/[id]/edit">) {
  const { id } = await params;
  const view = (await getAppData()).monitors.find((m) => m.monitor.id === id);
  if (!view) notFound();
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/monitors/${id}`} className="text-slate-500 hover:text-fig-plum">
          ← {view.monitor.name}
        </Link>
      </div>
      <PageHeader title="Edit monitor" description={`${view.client.name} · ${view.website.name}`} />
      <Panel className="max-w-2xl">
        <div className="p-5">
          <MonitorForm monitor={view.monitor} />
        </div>
      </Panel>
    </>
  );
}
