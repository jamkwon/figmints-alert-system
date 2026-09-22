"use client";

import { useState, useTransition } from "react";
import { runCheckAction, type RunCheckResult } from "@/app/actions";

export function RunCheckButton({
  monitorId,
  disabledReason,
  compact = false,
}: {
  monitorId: string;
  /** When set, the button is disabled and this explains why. */
  disabledReason?: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunCheckResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await runCheckAction(monitorId));
      } catch {
        setResult({ ok: false, message: "Could not reach the server." });
      }
    });
  }

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "flex items-center gap-3"}>
      <button
        type="button"
        onClick={run}
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason}
        className={`rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          compact
            ? "border-slate-300 bg-white px-2 py-1 text-xs text-fig-plum hover:border-fig-plum"
            : "border-fig-plum bg-fig-plum px-3 py-1.5 text-sm text-white hover:bg-fig-magenta"
        }`}
      >
        {pending ? "Running…" : compact ? "Run" : "Run check"}
      </button>
      {result && (
        <span
          role="status"
          className={`text-xs ${compact ? "max-w-40 text-right" : ""} ${result.ok ? "text-fig-teal" : "text-red-700"}`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
