"use client";

import { useActionState, useState } from "react";
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
import type { Client, Monitor, MonitorType, Website } from "@/lib/types";

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
  // Monitors need a website to point at, so that section waits for one.
  const [website, setWebsite] = useState(client?.primary_website ?? "");
  const hasWebsite = website.trim().length > 0;
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
        <input
          name="primary_website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={inputClass}
        />
      </Field>
      {!editing && !hasWebsite && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
          Enter the primary website to set up its monitors here. You can also add them later.
        </p>
      )}
      {!editing && hasWebsite && (
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
          <Checkbox name="ssl" label="Also check the SSL certificate (warns 14 days before it expires)" defaultChecked />
          <Checkbox name="links" label="Also scan the homepage for broken links (daily)" defaultChecked />
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
  const [pages, setPages] = useState("");
  const hasPages = pages.trim().length > 0;
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
        <textarea
          name="pages"
          rows={6}
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          placeholder={"/\n/contact | Contact Us\n/services"} className={`${inputClass} font-mono`} />
      </Field>
      {/* Hidden (not removed) so choices survive clearing the list; ignored without pages. */}
      <div className={hasPages ? "grid grid-cols-2 gap-3" : "hidden"}>
        <Field label="Check">
          <IntervalSelect />
        </Field>
        <Field label="Severity when failing">
          <SeveritySelect />
        </Field>
      </div>
      <Checkbox name="ssl" label="Also check the SSL certificate (skipped if this website already has one)" />
      <Checkbox name="links" label="Also scan the homepage for broken links, daily (skipped if it already has a scan)" />
      <p className="text-xs text-slate-500">
        {hasPages
          ? "Names come from the page path (you can rename them after). New monitors are checked within 5 minutes."
          : "No pages listed: only the ticked extra checks are added (SSL every 6 hours, link scan daily)."}
      </p>
      <FormActions label="Add monitors" cancelHref={`/clients/${clientId}`} />
    </form>
  );
}

const TYPE_HELP: Record<MonitorType, string> = {
  http_status: "Passes when the page answers HTTP 200–399, or exactly the expected status if set.",
  expected_content: "Passes when the page loads and contains the expected text.",
  response_time: "Warns when the full response takes longer than the limit.",
  ssl_expiry:
    "Checks the site's certificate: warning at 14 days left; failed at 3 days, or when expired or untrusted. Only the domain of the URL is used.",
  broken_links:
    "Checks up to 40 links, images and files on this page. Broken links raise a Warning.",
};

const SEVERITY_HELP: Partial<Record<MonitorType, string>> = {
  response_time: "Slow responses are always a Warning; this applies when the page fails.",
  ssl_expiry: "Expiring soon is always a Warning; this applies when the certificate fails.",
  broken_links: "Broken links are always a Warning; this applies if the page itself fails to load.",
};

const INTERVAL_HINT: Partial<Record<MonitorType, string>> = {
  ssl_expiry: "Every 6 hours is plenty for certificates.",
  broken_links: "Daily keeps scans polite (each scan makes up to 40 requests).",
};

export function MonitorForm({ monitor }: { monitor: Monitor }) {
  const [state, action] = useActionState(saveMonitorAction, initial);
  const [type, setType] = useState<MonitorType>(monitor.monitor_type);
  const fields = ["name", "monitor_type", "target_url", "expected_status_code", "expected_text", "max_response_time_ms"];
  // SSL and link scans have their own pass/fail rules, so page settings don't apply.
  const pageCheck = type !== "ssl_expiry" && type !== "broken_links";
  // Hidden fields stay in the form (so values survive switching type); the server ignores them.
  const show = (visible: boolean) => (visible ? undefined : "hidden");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={monitor.id} />
      <FormError state={state} fields={fields} />
      <Field label="Name" error={fieldError(state, "name")}>
        <input name="name" required maxLength={120} defaultValue={monitor.name} className={inputClass} />
      </Field>
      <Field label="Type" hint={TYPE_HELP[type]} error={fieldError(state, "monitor_type")}>
        <select
          name="monitor_type"
          value={type}
          onChange={(e) => setType(e.target.value as MonitorType)}
          className={inputClass}
        >
          {MONITOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {MONITOR_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={type === "ssl_expiry" ? "Website URL" : type === "broken_links" ? "Page to scan" : "URL"}
        hint={
          type === "ssl_expiry"
            ? "Any address on the site; only its domain's certificate is checked."
            : "A full URL, or a path on the website like /contact"
        }
        error={fieldError(state, "target_url")}
      >
        <input name="target_url" required defaultValue={monitor.target_url} className={inputClass} />
      </Field>
      <div className={show(pageCheck)}>
        {/* Two columns only when Max response time is shown; otherwise Expected status takes the full width. */}
        <div className={`grid gap-3 ${type === "response_time" ? "grid-cols-2" : "grid-cols-1"}`}>
          <Field label="Expected status" hint="Blank = any 200–399" error={fieldError(state, "expected_status_code")}>
            <input
              name="expected_status_code"
              inputMode="numeric"
              defaultValue={monitor.expected_status_code ?? ""}
              className={inputClass}
            />
          </Field>
          <div className={show(type === "response_time")}>
            <Field label="Max response time (ms)" hint="Blank = 3000 ms" error={fieldError(state, "max_response_time_ms")}>
              <input
                name="max_response_time_ms"
                inputMode="numeric"
                defaultValue={monitor.max_response_time_ms ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </div>
      <div className={show(pageCheck)}>
        <Field
          label={type === "expected_content" ? "Expected text" : "Expected text (optional)"}
          hint={
            type === "expected_content"
              ? "The check fails when this text isn't on the page."
              : "If set, the check also fails when this text isn't on the page."
          }
          error={fieldError(state, "expected_text")}
        >
          <input
            name="expected_text"
            maxLength={500}
            required={type === "expected_content"}
            defaultValue={monitor.expected_text ?? ""}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check" hint={INTERVAL_HINT[type]}>
          <IntervalSelect defaultValue={monitor.interval_minutes} />
        </Field>
        <Field label="Severity when failing" hint={SEVERITY_HELP[type]}>
          <SeveritySelect defaultValue={monitor.severity_on_failure} />
        </Field>
      </div>
      <Checkbox name="active" label="Active (uncheck to pause this monitor)" defaultChecked={monitor.active} />
      <FormActions label="Save monitor" cancelHref={`/monitors/${monitor.id}`} />
    </form>
  );
}
