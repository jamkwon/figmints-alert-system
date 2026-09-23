import Link from "next/link";
import { AccountBar } from "@/components/account-bar";
import { Sidebar } from "@/components/sidebar";
import { requireStaff } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";

// Everything except /login lives here: sidebar, sample-data banner, and a staff check.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireStaff();
  const usingSampleData = getDataSource() === "sample";

  return (
    <div className="flex min-h-screen w-full min-w-[1024px]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AccountBar user={user} />
        {usingSampleData && (
          <div className="border-b border-amber-200 bg-amber-100 px-8 py-2 text-sm text-amber-900">
            Showing <strong>sample data</strong>. Supabase is not configured.{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Setup details
            </Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
