"use client";

import { useActionState, type ReactNode } from "react";
import { saveSettingsAction, type FormState } from "@/app/manage-actions";
import { Checkbox, Field, FormActions, FormError, fieldError, inputClass } from "@/components/form";
import { SETTING_FIELDS as F, SETTING_LIMITS as L, WEEKDAY_NAMES, type AppSettings } from "@/lib/settings";

const initial: FormState = { ok: true };

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-slate-100 px-4 py-4 first:border-t-0">
      <legend className="float-left mb-3 w-full text-xs font-medium tracking-wide text-slate-500 uppercase">
        {title}
      </legend>
      <div className="clear-both grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function NumberInput({ name, value, limit }: { name: string; value: number; limit: { min: number; max: number } }) {
  return (
    <input
      type="number"
      name={name}
      defaultValue={value}
      min={limit.min}
      max={limit.max}
      step={1}
      required
      className={inputClass}
    />
  );
}

export function SettingsForm({ settings, disabledReason }: { settings: AppSettings; disabledReason?: string }) {
  const [state, action] = useActionState(saveSettingsAction, initial);
  const err = (field: string) => fieldError(state, field);

  return (
    <form action={action}>
      <fieldset disabled={Boolean(disabledReason)} className="disabled:opacity-60">
        <Group title="Incidents">
          <Field
            label="Failed checks before an incident opens"
            hint="In a row. 1 alerts on the first failure; higher is quieter."
            error={err(F.failuresToOpen)}
          >
            <NumberInput name={F.failuresToOpen} value={settings.failuresToOpen} limit={L.failuresToOpen} />
          </Field>
          <Field label="Passing checks before it resolves" hint="In a row." error={err(F.passesToResolve)}>
            <NumberInput name={F.passesToResolve} value={settings.passesToResolve} limit={L.passesToResolve} />
          </Field>
          <Field
            label="Default response time limit (ms)"
            hint="For Response Time monitors that don't set their own."
            error={err(F.defaultMaxResponseMs)}
          >
            <NumberInput name={F.defaultMaxResponseMs} value={settings.defaultMaxResponseMs} limit={L.defaultMaxResponseMs} />
          </Field>
        </Group>

        <Group title="SSL certificates">
          <Field label="Warning when it expires within (days)" error={err(F.sslWarningDays)}>
            <NumberInput name={F.sslWarningDays} value={settings.sslWarningDays} limit={L.sslWarningDays} />
          </Field>
          <Field
            label="Failed when it expires within (days)"
            hint="Fewer days than the warning. Expired or untrusted certificates always fail."
            error={err(F.sslFailureDays)}
          >
            <NumberInput name={F.sslFailureDays} value={settings.sslFailureDays} limit={L.sslFailureDays} />
          </Field>
        </Group>

        <Group title="WordPress Health">
          <Field
            label="Backup missing after (hours)"
            hint="No completed WP Engine backup in this time is Critical."
            error={err(F.backupMaxAgeHours)}
          >
            <NumberInput name={F.backupMaxAgeHours} value={settings.backupMaxAgeHours} limit={L.backupMaxAgeHours} />
          </Field>
          <Field
            label="Minimum PHP version"
            hint={'Lower is a Warning. Leave empty to not check PHP. Supported versions: php.net/supported-versions.'}
            error={err(F.minPhpVersion)}
          >
            <input
              name={F.minPhpVersion}
              defaultValue={settings.minPhpVersion ?? ""}
              placeholder="e.g. 8.2"
              pattern={"[5-9]\\.[0-9]{1,2}"}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              name={F.warnOnUpdates}
              label="Available WordPress, plugin and theme updates count as a Warning"
              defaultChecked={settings.warnOnUpdates}
            />
            <p className="mt-1 ml-6 text-xs text-slate-500">
              Unticked, updates are still listed on monitor pages and in the weekly summary, but don&apos;t turn sites
              yellow. Backups, PHP errors and downtime alert either way.
            </p>
          </div>
        </Group>

        <Group title="Page speed">
          <Field
            label="Warn below this performance score"
            hint="Google PageSpeed's 0–100 score on mobile. 0 turns the score warning off (failing Core Web Vitals still warn)."
            error={err(F.minPerformanceScore)}
          >
            <NumberInput name={F.minPerformanceScore} value={settings.minPerformanceScore} limit={L.minPerformanceScore} />
          </Field>
        </Group>

        <Group title="Weekly summary">
          <div className="sm:col-span-2">
            <Checkbox name={F.summaryEnabled} label="Post a weekly summary to Slack" defaultChecked={settings.summaryEnabled} />
          </div>
          <Field label="Day" error={err(F.summaryWeekday)}>
            <select name={F.summaryWeekday} defaultValue={settings.summaryWeekday} className={inputClass}>
              {WEEKDAY_NAMES.map((day, i) => (
                <option key={day} value={i + 1}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time" hint="In the app's timezone." error={err(F.summaryHour)}>
            <select name={F.summaryHour} defaultValue={settings.summaryHour} className={inputClass}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {`${h}:00`}
                </option>
              ))}
            </select>
          </Field>
        </Group>
      </fieldset>

      <div className="space-y-3 border-t border-slate-100 px-4 py-4">
        <FormError state={state} fields={Object.values(F)} />
        {disabledReason ? (
          <p className="text-sm text-slate-500">{disabledReason}</p>
        ) : (
          <FormActions label="Save settings" cancelHref="/settings" />
        )}
      </div>
    </form>
  );
}
