import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: PageProps<"/clients/[id]/edit">) {
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
      <PageHeader title="Edit client" />
      <Panel className="max-w-2xl">
        <div className="p-5">
          <ClientForm client={view.client} />
        </div>
      </Panel>
    </>
  );
}
