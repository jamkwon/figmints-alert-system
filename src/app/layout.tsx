import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import localFont from "next/font/local";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { getDataSource } from "@/lib/data";
import "./globals.css";

// Brand fonts: Figtree for text, Montreal for titles and display.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

// No SemiBold cut exists, so Medium stands in for the brand guide's "semibold".
const montreal = localFont({
  variable: "--font-montreal",
  src: [
    { path: "./fonts/Montreal Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Montreal Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Website Watch", template: "%s · Website Watch" },
  description: "Figmints Website Health Monitor (internal)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const usingSampleData = getDataSource() === "sample";

  return (
    <html lang="en" className={`${figtree.variable} ${montreal.variable} antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> */}
      <body className="flex min-h-screen min-w-[1024px] font-sans" suppressHydrationWarning>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
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
      </body>
    </html>
  );
}
