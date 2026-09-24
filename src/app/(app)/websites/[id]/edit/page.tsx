import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WebsiteForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Edit website" };

export default async function EditWebsitePage({ params }: PageProps<"/websites/[id]/edit">) {
  const { id } = await params;
  const view = (await getAppData()).clients.find((c) => c.websites.some((w) => w.website.id === id));
  const website = view?.websites.find((w) => w.website.id === id)?.website;
  if (!view || !website) notFound();
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/clients/${view.client.id}`} className="text-slate-500 hover:text-fig-plum">
          ← {view.client.name}
        </Link>
      </div>
      <PageHeader title="Edit website" />
      <Panel className="max-w-2xl">
        <div className="p-5">
          <WebsiteForm clientId={view.client.id} website={website} />
        </div>
      </Panel>
    </>
  );
}
