import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WebsiteForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Add website" };

export default async function NewWebsitePage({ params }: PageProps<"/clients/[id]/websites/new">) {
  const { id } = await params;
  const view = (await getAppData()).clients.find((c) => c.client.id === id);
  if (!view) notFound();
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/clients/${id}`} className="text-slate-500 hover:text-fig-plum">
          ← {view.client.name}
        </Link>
      </div>
      <PageHeader title="Add website" description="Another site or environment for this client, e.g. staging." />
      <Panel className="max-w-2xl">
        <div className="p-5">
          <WebsiteForm clientId={id} />
        </div>
      </Panel>
    </>
  );
}
