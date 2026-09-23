"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  setIncidentStatusAction,
  updateIncidentDetailsAction,
  type IncidentActionResult,
} from "@/app/actions";
import { TEAM_LABELS } from "@/lib/labels";
import type { AssignedTeam, IncidentStatus } from "@/lib/types";

const STATUS_ACTIONS: { status: IncidentStatus; label: string; primary?: boolean }[] = [
  { status: "investigating", label: "Mark Investigating" },
  { status: "snoozed", label: "Snooze" },
  { status: "expected_maintenance", label: "Expected Maintenance" },
  { status: "ignored", label: "Ignore" },
  { status: "open", label: "Reopen" },
  { status: "resolved", label: "Resolve", primary: true },
];

function Feedback({ result }: { result: IncidentActionResult | null }) {
  if (!result) return null;
  return (
    <span role="status" className={`text-xs ${result.ok ? "text-fig-teal" : "text-red-700"}`}>
      {result.message}
    </span>
  );
}

export function IncidentControls({
  incidentId,
  status,
  closed,
  team,
  notes,
  disabledReason,
}: {
  incidentId: string;
  status: IncidentStatus;
  /** Resolved (or auto-closed) incidents can't change status, only team and notes. */
  closed: boolean;
  team: AssignedTeam;
  notes: string;
  disabledReason?: string;
}) {
  const [statusPending, startStatus] = useTransition();
  const [statusResult, setStatusResult] = useState<IncidentActionResult | null>(null);
  const [savePending, startSave] = useTransition();
  const [saveResult, setSaveResult] = useState<IncidentActionResult | null>(null);
  const [draftTeam, setDraftTeam] = useState(team);
  const [draftNotes, setDraftNotes] = useState(notes);
  const disabled = Boolean(disabledReason);
  const dirty = draftTeam !== team || draftNotes.trim() !== notes.trim();

  function changeStatus(next: IncidentStatus) {
    setStatusResult(null);
    startStatus(async () => {
      try {
        setStatusResult(await setIncidentStatusAction(incidentId, next));
      } catch {
        setStatusResult({ ok: false, message: "Could not reach the server." });
      }
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    setSaveResult(null);
    startSave(async () => {
      try {
        setSaveResult(await updateIncidentDetailsAction(incidentId, draftTeam, draftNotes));
      } catch {
        setSaveResult({ ok: false, message: "Could not reach the server." });
      }
    });
  }

  return (
    <div className="space-y-5 px-4 py-4">
      {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}

      <div>
        <div className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Status</div>
        {closed ? (
          <p className="text-sm text-slate-600">
            Closed. If the problem comes back, a new incident opens automatically.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_ACTIONS.filter((a) => a.status !== status).map((action) => (
              <button
                key={action.status}
                type="button"
                disabled={disabled || statusPending}
                onClick={() => changeStatus(action.status)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  action.primary
                    ? "border-fig-teal bg-fig-teal text-white hover:bg-fig-teal-dark"
                    : "border-slate-300 bg-white text-fig-ink hover:border-fig-plum hover:text-fig-plum"
                }`}
              >
                {action.label}
              </button>
            ))}
            {statusPending && <span className="text-xs text-slate-500">Updating…</span>}
            <Feedback result={statusResult} />
          </div>
        )}
      </div>

      <form onSubmit={save} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase">Assigned team</span>
          <select
            value={draftTeam}
            disabled={disabled}
            onChange={(e) => setDraftTeam(e.target.value as AssignedTeam)}
            className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-fig-plum focus:outline-none"
          >
            {(Object.keys(TEAM_LABELS) as AssignedTeam[]).map((t) => (
              <option key={t} value={t}>
                {TEAM_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase">Internal notes</span>
          <textarea
            value={draftNotes}
            disabled={disabled}
            onChange={(e) => setDraftNotes(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder="What have we found? What's the next step?"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-fig-plum focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled || savePending || !dirty}
            className="rounded-md border border-fig-plum bg-fig-plum px-3 py-1.5 text-sm font-medium text-white hover:bg-fig-magenta disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savePending ? "Saving…" : "Save"}
          </button>
          <Feedback result={saveResult} />
        </div>
      </form>
    </div>
  );
}
