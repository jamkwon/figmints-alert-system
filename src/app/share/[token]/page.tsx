import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { MonthPicker, MonthlyReportView } from "@/components/monthly-report";
import { PrintButton } from "@/components/print-button";
import { getSharedAccess, loadReportInput } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { buildMonthlyReport, forSharing, monthRange, recentMonths } from "@/lib/report";
import { SharePasswordForm } from "./password-form";

// A client's live report from a link staff send them (/share/<token>): no staff
// login, no sidebar, nothing but that one client's report, after the link's
// password. The proxy lets /share/ through; the token and password are checked
// here. Unknown and revoked links look the same.

export const metadata: Metadata = {
  title: { absolute: "Website report · Figmints" },
  robots: { index: false, follow: false },
  // The token is in the URL: don't pass it on to sites the page links to.
  referrer: "no-referrer",
};

export default async function SharedReportPage({ params, searchParams }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const access = await getSharedAccess(token);
  if (!access) notFound();
  if (access === "locked") {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-col justify-center px-4 py-12">
        <div className="rounded-xl bg-fig-brand px-6 py-6 text-white">
          <Image src="/figmints-logo-white.svg" alt="Figmints" width={130} height={40} priority />
          <h1 className="mt-5 font-display text-2xl font-bold">Your website report</h1>
          <p className="mt-1 text-sm text-white/80">Enter the password Figmints sent you with this link.</p>
        </div>
        <SharePasswordForm token={token} />
      </main>
    );
  }
  const { clientId } = access;
  const sp = await searchParams;
  const months = recentMonths(new Date(), APP_TIMEZONE);
  // Default to this month so far: the link is a live view, not last month's report.
  const requested = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : months[0];
  const month = monthRange(requested, APP_TIMEZONE);
  if (!month) notFound();
  const data = await loadReportInput(clientId, month);
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-end gap-3 print:hidden">
        <MonthPicker months={months} selected={month.key} />
        <PrintButton />
      </div>
      <MonthlyReportView clientName={data.client.name} report={forSharing(buildMonthlyReport(data.input))} />
    </main>
  );
}
