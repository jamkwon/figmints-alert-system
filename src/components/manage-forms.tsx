"use client";

import { useActionState } from "react";
import {
  addMonitorsAction,
  saveClientAction,
  saveMonitorAction,
  saveWebsiteAction,
  type FormState,
} from "@/app/manage-actions";
import { Checkbox, Field, FormActions, FormError, fieldError, inputClass } from "@/components/form";
import {
  ENVIRONMENTS,
  ENVIRONMENT_LABELS,
  INTERVALS,
  MONITOR_TYPES,
  MONITOR_TYPE_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  formatInterval,
} from "@/lib/labels";
import type { Client, Monitor, Website } from "@/lib/types";

const initial: FormState = { ok: true };

function IntervalSelect({ defaultValue = 15 }: { defaultValue?: number }) {
  return (
    <select name="interval_minutes" defaultValue={defaultValue} className={inputClass}>
      {INTERVALS.map((m) => (
        <option key={m} value={m}>
          {formatInterval(m)}
        </option>
      ))}
    </select>
  );
}

function SeveritySelect({ defaultValue = "critical" }: { defaultValue?: string }) {
  return (
    <select name="severity_on_failure" defaultValue={defaultValue} className={inputClass}>
      {SEVERITIES.map((s) => (
        <option key={s} value={s}>
          {SEVERITY_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

const PAGES_HINT = (
  <>
    One page per line: a path like <code>/contact</code> or a full URL. Add <code>| text</code> to also check that
    text appears, e.g. <code>/contact | Contact Us</code>.
  </>
);

// Clients -----------------------------------------------------------------------

export function ClientForm({ client }: { client?: Client }) {
  const [state, action] = useActionState(saveClientAction, initial);
  const editing = Boolean(client);
  return (
    <form action={action} className="space-y-4">
      {client && <input type="hidden" name="id" value={client.id} />}
      <FormError state={state} fields={["name", "primary_website", "notes", "pages"]} />
      <Field label="Client name" error={fieldError(state, "name")}>
        <input name="name" required maxLength={120} defaultValue={client?.name} className={inputClass} />
      </Field>
      <Field
        label="Primary website"
        hint={editing ? "Shown on the client page. Manage monitored sites under Websites." : "e.g. https://www.example.com"}
        error={fieldError(state, "primary_website")}
      >
        <input name="primary_website" defaultValue={client?.primary_website ?? ""} className={inputClass} />
      </Field>
      {!editing && (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-fig-ink">Monitors to create</legend>
          <Field label="Pages" hint={PAGES_HINT} error={fieldError(state, "pages")}>
            <textarea name="pages" rows={4} defaultValue={"/\n/contact"} className={`${inputClass} font-mono`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check">
              <IntervalSelect />
            </Field>
            <Field label="Severity when failing">
              <SeveritySelect />
            </Field>
          </div>
          <p className="text-xs text-slate-500">Leave Pages empty to add monitors later. New monitors are checked within 5 minutes.</p>
        </fieldset>
      )}
      <Field label="Internal notes" error={fieldError(state, "notes")}>
        <textarea name="notes" rows={3} defaultValue={client?.notes} className={inputClass} />
      </Field>
      {editing && <Checkbox name="active" label="Active (inactive clients aren't checked)" defaultChecked={client!.active} />}
      <FormActions label={editing ? "Save client" : "Create client"} cancelHref={client ? `/clients/${client.id}` : "/clients"} />
    </form>
  );
}

// Websites ----------------------------------------------------------------------

export function WebsiteForm({ clientId, website }: { clientId: string; website?: Website }) {
  const [state, action] = useActionState(saveWebsiteAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="client_id" value={clientId} />
      {website && <input type="hidden" name="id" value={website.id} />}
      <FormError state={state} fields={["name", "url", "environment"]} />
      <Field label="Name" hint='e.g. "Main site" or "Staging"' error={fieldError(state, "name")}>
        <input name="name" required maxLength={120} defaultValue={website?.name ?? "Main site"} className={inputClass} />
      </Field>
      <Field label="URL" error={fieldError(state, "url")}>
        <input name="url" required defaultValue={website?.url} placeholder="https://www.example.com" className={inputClass} />
      </Field>
      <Field label="Environment" error={fieldError(state, "environment")}>
        <select name="environment" defaultValue={website?.environment ?? "production"} className={inputClass}>
          {ENVIRONMENTS.map((e) => (
            <option key={e} value={e}>
              {ENVIRONMENT_LABELS[e]}
            </option>
          ))}
        </select>
      </Field>
      {website && <Checkbox name="active" label="Active (inactive websites aren't checked)" defaultChecked={website.active} />}
      <FormActions label={website ? "Save website" : "Add website"} cancelHref={`/clients/${clientId}`} />
    </form>
  );
}

// Monitors ----------------------------------------------------------------------

export function AddMonitorsForm({
  clientId,
  websites,
  defaultWebsiteId,
}: {
  clientId: string;
  websites: Website[];
  defaultWebsiteId?: string;
}) {
  const [state, action] = useActionState(addMonitorsAction, initial);
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} fields={["website_id", "pages"]} />
      <Field label="Website" error={fieldError(state, "website_id")}>
        <select name="website_id" defaultValue={defaultWebsiteId ?? websites[0]?.id} className={inputClass}>
          {websites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.url} ({ENVIRONMENT_LABELS[w.environment]})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pages" hint={PAGES_HINT} error={fieldError(state, "pages")}>
        <textarea name="pages" rows={6} required placeholder={"/\n/contact | Contact Us\n/services"} className={`${inputClass} font-mono`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check">
          <IntervalSelect />
        </Field>
        <Field label="Severity when failing">
          <SeveritySelect />
        </Field>
      </div>
      <p className="text-xs text-slate-500">
        Names come from the page path (you can rename them after). New monitors are checked within 5 minutes.
      </p>
      <FormActions label="Add monitors" cancelHref={`/clients/${clientId}`} />
    </form>
  );
}

export function MonitorForm({ monitor }: { monitor: Monitor }) {
  const [state, action] = useActionState(saveMonitorAction, initial);
  const fields = ["name", "monitor_type", "target_url", "expected_status_code", "expected_text", "max_response_time_ms"];
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={monitor.id} />
      <FormError state={state} fields={fields} />
      <Field label="Name" error={fieldError(state, "name")}>
        <input name="name" required maxLength={120} defaultValue={monitor.name} className={inputClass} />
      </Field>
      <Field label="URL" hint="A full URL, or a path on the website like /contact" error={fieldError(state, "target_url")}>
        <input name="target_url" required defaultValue={monitor.target_url} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" error={fieldError(state, "monitor_type")}>
          <select name="monitor_type" defaultValue={monitor.monitor_type} className={inputClass}>
            {MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {MONITOR_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected status" hint="Blank = any 200–399" error={fieldError(state, "expected_status_code")}>
          <input
            name="expected_status_code"
            inputMode="numeric"
            defaultValue={monitor.expected_status_code ?? ""}
            className={inputClass}
          />
        </Field>
      </div>
      <Field
        label="Expected text"
        hint="Required for Expected Content. Optional for other types (also checked if set)."
        error={fieldError(state, "expected_text")}
      >
        <input name="expected_text" maxLength={500} defaultValue={monitor.expected_text ?? ""} className={inputClass} />
      </Field>
      <Field
        label="Max response time (ms)"
        hint="Response Time monitors only. Blank = 3000 ms."
        error={fieldError(state, "max_response_time_ms")}
      >
        <input
          name="max_response_time_ms"
          inputMode="numeric"
          defaultValue={monitor.max_response_time_ms ?? ""}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check">
          <IntervalSelect defaultValue={monitor.interval_minutes} />
        </Field>
        <Field label="Severity when failing">
          <SeveritySelect defaultValue={monitor.severity_on_failure} />
        </Field>
      </div>
      <Checkbox name="active" label="Active (uncheck to pause this monitor)" defaultChecked={monitor.active} />
      <FormActions label="Save monitor" cancelHref={`/monitors/${monitor.id}`} />
    </form>
  );
}
