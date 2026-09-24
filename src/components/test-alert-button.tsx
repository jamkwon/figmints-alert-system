"use client";

import { useState, useTransition } from "react";
import { sendTestAlertAction, type RunCheckResult } from "@/app/actions";

export function TestAlertButton({ disabledReason }: { disabledReason?: string }) {
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
              setResult(await sendTestAlertAction());
            } catch {
              setResult({ ok: false, message: "Could not reach the server." });
            }
          });
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send test alert"}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
