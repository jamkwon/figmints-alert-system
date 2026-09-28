"use client";

import { useState, useTransition } from "react";
import { sendTestAlertAction, sendWeeklySummaryAction, type RunCheckResult } from "@/app/actions";

const ACTIONS = {
  test: { run: sendTestAlertAction, label: "Send test alert" },
  summary: { run: sendWeeklySummaryAction, label: "Send summary now" },
};

export function TestAlertButton({
  disabledReason,
  kind = "test",
}: {
  disabledReason?: string;
  /** Which Slack message to send: a test alert, or this week's summary. */
  kind?: keyof typeof ACTIONS;
}) {
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
              setResult(await ACTIONS[kind].run());
            } catch {
              setResult({ ok: false, message: "Could not reach the server." });
            }
          });
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending…" : ACTIONS[kind].label}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
