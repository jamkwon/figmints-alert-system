"use client";

import { useState, useTransition } from "react";
import { setMaintenanceAction, type FormState } from "@/app/manage-actions";
import { MAINTENANCE_HOURS, durationLabel } from "@/lib/labels";

const compactInput =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-fig-ink focus:border-fig-plum focus:outline-none";

/** Start or end a website's maintenance window. */
export function MaintenanceControl({
  websiteId,
  inMaintenance,
  disabledReason,
}: {
  websiteId: string;
  inMaintenance: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FormState | null>(null);
  const [hours, setHours] = useState<number>(4);
  const [note, setNote] = useState("");
  const disabled = pending || Boolean(disabledReason);

  function submit(h: number) {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await setMaintenanceAction(websiteId, h, note));
      } catch {
        setResult({ ok: false, message: "Could not reach the server." });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" title={disabledReason}>
      {inMaintenance ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => submit(0)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum disabled:cursor-not-allowed disabled:opacity-50"
        >
          End maintenance
        </button>
      ) : (
        <>
          <select
            aria-label="Maintenance length"
            value={hours}
            disabled={disabled}
            onChange={(e) => setHours(Number(e.target.value))}
            className={compactInput}
          >
            {MAINTENANCE_HOURS.map((h) => (
              <option key={h} value={h}>
                {durationLabel(h)}
              </option>
            ))}
          </select>
          <input
            aria-label="Maintenance note"
            placeholder="Note (optional)"
            value={note}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => setNote(e.target.value)}
            className={`${compactInput} w-40`}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => submit(hours)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start maintenance
          </button>
        </>
      )}
      {result && <span className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>{result.message}</span>}
    </div>
  );
}
