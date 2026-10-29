import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthPicker, MonthlyReportView } from "@/components/monthly-report";
import { PrintButton } from "@/components/print-button";
import { getReportInput } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { buildMonthlyReport, monthRange, recentMonths } from "@/lib/report";

export const metadata: Metadata = { title: "Monthly report" };

export default async function MonthlyReportPage({ params, searchParams }: PageProps<"/clients/[id]/report">) {
  const { id } = await params;
  const sp = await searchParams;
  const months = recentMonths(new Date(), APP_TIMEZONE);
  // Default to last month: the one to send at the start of a month.
  const requested = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : months[1];
  const month = monthRange(requested, APP_TIMEZONE);
  if (!month) notFound();
  const data = await getReportInput(id, month);
  if (!data) notFound();
  const { client } = data;

  return (
    <div className="space-y-6">
      {/* Controls: not printed. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/clients/${client.id}`} className="text-sm text-slate-600 hover:text-fig-plum">
          ← {client.name}
        </Link>
        <div className="flex items-center gap-3">
          <MonthPicker months={months} selected={month.key} />
          <PrintButton />
        </div>
      </div>

      <MonthlyReportView clientName={client.name} report={buildMonthlyReport(data.input)} />
    </div>
  );
}
