"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/incidents", label: "Incidents" },
  { href: "/checks", label: "Checks" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-fig-brand text-white">
      <Link href="/" className="block border-b border-white/10 px-5 py-5">
        <Image src="/figmints-logo-white.svg" alt="Figmints" width={120} height={37} priority />
        <div className="mt-2 font-display text-base font-medium tracking-wide">Website Watch</div>
        <div className="text-xs text-white/50">Website Health Monitor</div>
      </Link>
      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                    active
                      ? "border-fig-pink bg-white/10 font-semibold text-white"
                      : "border-transparent text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-white/40">Internal use only</div>
    </aside>
  );
}
