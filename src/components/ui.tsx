import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime, formatFull, timeAgo } from "@/lib/format";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fig-plum-dark">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-slate-200 bg-white ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-fig-ink">{title}</h2>
          {aside && <div className="text-xs text-slate-500">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** Absolute time with relative time underneath; full timestamp on hover. */
export function When({ iso, empty = "Never" }: { iso: string | null | undefined; empty?: string }) {
  if (!iso) return <span className="text-slate-400">{empty}</span>;
  return (
    <time dateTime={iso} title={formatFull(iso)} className="block whitespace-nowrap">
      <span className="text-fig-ink">{formatDateTime(iso)}</span>
      <span className="block text-xs text-slate-500">{timeAgo(iso)}</span>
    </time>
  );
}

// Shared table styling
export const table = {
  wrapper: "overflow-x-auto",
  table: "w-full text-left text-sm",
  head: "border-b border-slate-200 bg-white text-xs font-medium uppercase tracking-wide text-fig-plum/80",
  th: "px-4 py-2.5 font-medium",
  row: "border-b border-slate-100 last:border-0 align-top hover:bg-fig-plum-mist",
  td: "px-4 py-3",
};

/** A link styled as a button, for page actions like "Add client". */
export function LinkButton({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap ${
        primary
          ? "border-fig-plum bg-fig-plum text-white hover:bg-fig-magenta"
          : "border-slate-300 bg-white text-fig-ink hover:border-fig-plum hover:text-fig-plum"
      }`}
    >
      {children}
    </Link>
  );
}
