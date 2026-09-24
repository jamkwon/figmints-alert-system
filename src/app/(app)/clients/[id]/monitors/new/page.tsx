import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddMonitorsForm, MonitorForm } from "@/components/manage-forms";
import { Panel, PageHeader } from "@/components/ui";
import { getAppData } from "@/lib/data";

export const metadata: Metadata = { title: "Add monitors" };

// "One monitor" is the default; the quick bulk form is the second tab.
const TABS = {
  single: { label: "One monitor (all settings)", description: "Choose the type and every setting in one step." },
  quick: { label: "Several pages (quick)", description: "Add several pages at once. Fine-tune each monitor afterwards." },
} as const;

export default async function NewMonitorsPage({ params, searchParams }: PageProps<"/clients/[id]/monitors/new">) {
  const { id } = await params;
  const sp = await searchParams;
  const website = typeof sp.website === "string" ? sp.website : undefined;
  const mode: keyof typeof TABS = sp.mode === "quick" ? "quick" : "single";
  const view = (await getAppData()).clients.find((c) => c.client.id === id);
  if (!view) notFound();
  const websites = view.websites.map((w) => w.website);
  const tabHref = (m: keyof typeof TABS) => {
    const q = new URLSearchParams({ ...(m === "quick" ? { mode: "quick" } : {}), ...(website ? { website } : {}) });
    const qs = q.toString();
    return `/clients/${id}/monitors/new${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href={`/clients/${id}`} className="text-slate-500 hover:text-fig-plum">
          ← {view.client.name}
        </Link>
      </div>
      <PageHeader title="Add monitors" description={TABS[mode].description} />
      <nav className="mb-4 flex max-w-2xl gap-1 border-b border-slate-200" aria-label="How to add">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((m) => (
          <Link
            key={m}
            href={tabHref(m)}
            aria-current={m === mode ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              m === mode ? "border-fig-plum font-semibold text-fig-plum" : "border-transparent text-slate-600 hover:text-fig-ink"
            }`}
          >
            {TABS[m].label}
          </Link>
        ))}
      </nav>
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
          ) : mode === "single" ? (
            <MonitorForm create={{ clientId: id, websites, defaultWebsiteId: website }} />
          ) : (
            <AddMonitorsForm clientId={id} websites={websites} defaultWebsiteId={website} />
          )}
        </div>
      </Panel>
    </>
  );
}
