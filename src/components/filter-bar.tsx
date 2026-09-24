import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

export const filterInputClass =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-fig-ink focus:border-fig-plum focus:outline-none";

export function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      <select name={name} defaultValue={value ?? ""} className={filterInputClass}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * GET form: filters live in the URL, so a filtered view can be bookmarked or shared.
 * `keep` carries other params (e.g. the incidents tab) through a filter change.
 */
export function FilterBar({
  action,
  keep,
  active,
  children,
}: {
  action: string;
  keep?: Record<string, string | undefined>;
  active: boolean;
  children: ReactNode;
}) {
  const clearHref = keep
    ? `${action}?${new URLSearchParams(Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1])))}`
    : action;
  return (
    <Form action={action} className="mb-4 flex flex-wrap items-end gap-3">
      {Object.entries(keep ?? {}).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button
        type="submit"
        className="rounded-md border border-fig-plum bg-fig-plum px-3 py-1.5 text-sm font-medium text-white hover:bg-fig-magenta"
      >
        Filter
      </button>
      {active && (
        <Link href={clearHref.replace(/\?$/, "")} className="py-1.5 text-sm text-slate-600 hover:text-fig-plum hover:underline">
          Clear filters
        </Link>
      )}
    </Form>
  );
}

/** First value of a search param, trimmed; undefined when empty. */
export function param(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim() ? v.trim() : undefined;
}
