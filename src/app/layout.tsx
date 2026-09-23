import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import localFont from "next/font/local";
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

// The app shell (sidebar, banner, login check) lives in (app)/layout.tsx so the
// login page can render without it.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} ${montreal.variable} antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> */}
      <body className="flex min-h-screen font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
