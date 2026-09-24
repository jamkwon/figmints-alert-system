"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/manage-actions";

export const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-fig-ink focus:border-fig-plum focus:outline-none";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-fig-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-700">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      )}
    </label>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  value,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  /** For checkbox groups sharing a name. */
  value?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-fig-ink">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 accent-fig-plum"
      />
      {label}
    </label>
  );
}

/** Shows the form-level error, unless it belongs to a specific field. */
export function FormError({ state, fields }: { state: FormState; fields: string[] }) {
  if (state.ok || !state.message || (state.field && fields.includes(state.field))) return null;
  return (
    <p role="alert" className="rounded-md bg-fig-coral-wash px-3 py-2 text-sm text-red-800">
      {state.message}
    </p>
  );
}

export function fieldError(state: FormState, field: string): string | undefined {
  return !state.ok && state.field === field ? state.message : undefined;
}

export function FormActions({ label, cancelHref }: { label: string; cancelHref: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3 pt-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-fig-plum bg-fig-plum px-4 py-1.5 text-sm font-medium text-white hover:bg-fig-magenta disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : label}
      </button>
      <Link href={cancelHref} className="text-sm text-slate-600 hover:text-fig-plum hover:underline">
        Cancel
      </Link>
    </div>
  );
}
