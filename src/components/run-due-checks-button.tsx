"use client";

import { useState, useTransition } from "react";
import { runDueChecksAction, type RunCheckResult } from "@/app/actions";

export function RunDueChecksButton({ disabledReason }: { disabledReason?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RunCheckResult | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            try {
              setResult(await runDueChecksAction());
            } catch {
              setResult({ ok: false, message: "Could not reach the server." });
            }
          });
        }}
        className="rounded-md border border-fig-plum bg-fig-plum px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-fig-magenta disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Running due checks…" : "Run due checks now"}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
