import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddMonitorsForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Add monitors" };

export default async function NewMonitorsPage({ params, searchParams }: PageProps<"/clients/[id]/monitors/new">) {
  const { id } = await params;
  const { website } = await searchParams;
  const view = (await getAppData()).clients.find((c) => c.client.id === id);
  if (!view) notFound();
  const websites = view.websites.map((w) => w.website);
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/clients/${id}`} className="text-slate-500 hover:text-fig-plum">
          ← {view.client.name}
        </Link>
      </div>
      <PageHeader title="Add monitors" description="Add several pages at once. Fine-tune each monitor afterwards." />
      <Panel className="max-w-2xl">
        <div className="p-5">
          {websites.length === 0 ? (
            <p className="text-sm text-slate-600">
              This client has no websites yet.{" "}
              <Link href={`/clients/${id}/websites/new`} className="text-fig-plum hover:underline">
                Add a website first
              </Link>
              .
            </p>
          ) : (
            <AddMonitorsForm
              clientId={id}
              websites={websites}
              defaultWebsiteId={typeof website === "string" ? website : undefined}
            />
          )}
        </div>
      </Panel>
    </>
  );
}
