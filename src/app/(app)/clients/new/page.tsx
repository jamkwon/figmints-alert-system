import type { Metadata } from "next";
import Link from "next/link";
import { ClientForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requireStaff();
  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/clients" className="text-slate-500 hover:text-fig-plum">
          ← Clients
        </Link>
      </div>
      <PageHeader title="Add client" description="Creates the client, its main website and its first monitors." />
      <Panel className="max-w-2xl">
        <div className="p-5">
          <ClientForm />
        </div>
      </Panel>
    </>
  );
}
