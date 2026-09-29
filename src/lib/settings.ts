// Monitoring rules that staff can change in Settings. Stored in one database
// row (app_settings); every value falls back to these defaults. Pure (no
// imports) so rules, forms and tests can all use it.

export interface AppSettings {
  /** Consecutive failed checks before an incident opens. */
  failuresToOpen: number;
  /** Consecutive passing checks before it resolves. */
  passesToResolve: number;
  /** "Slow" limit for monitors that don't set their own. */
  defaultMaxResponseMs: number;
  /** SSL certificates: Warning within this many days of expiry... */
  sslWarningDays: number;
  /** ...and Failed within this many. */
  sslFailureDays: number;
  /** WordPress Health: backups older than this are Critical. */
  backupMaxAgeHours: number;
  /** WordPress Health: PHP below this is a Warning; null doesn't check PHP. */
  minPhpVersion: string | null;
  /** WordPress Health: available core, plugin and theme updates count as a Warning. */
  warnOnUpdates: boolean;
  summaryEnabled: boolean;
  /** 1 = Monday … 7 = Sunday. */
  summaryWeekday: number;
  /** Hour of the day (0–23) in APP_TIMEZONE. */
  summaryHour: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  failuresToOpen: 2,
  passesToResolve: 2,
  defaultMaxResponseMs: 3000,
  sslWarningDays: 14,
  sslFailureDays: 3,
  backupMaxAgeHours: 48,
  minPhpVersion: "8.2",
  warnOnUpdates: true,
  summaryEnabled: true,
  summaryWeekday: 1,
  summaryHour: 9,
};

type NumberKey = {
  [K in keyof AppSettings]: AppSettings[K] extends number ? K : never;
}[keyof AppSettings];

/** Allowed ranges (inclusive). The database enforces the same limits. */
export const SETTING_LIMITS: Record<NumberKey, { min: number; max: number }> = {
  failuresToOpen: { min: 1, max: 10 },
  passesToResolve: { min: 1, max: 10 },
  defaultMaxResponseMs: { min: 500, max: 30000 },
  sslWarningDays: { min: 1, max: 90 },
  sslFailureDays: { min: 0, max: 60 },
  backupMaxAgeHours: { min: 12, max: 720 },
  summaryWeekday: { min: 1, max: 7 },
  summaryHour: { min: 0, max: 23 },
};

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Form field (and database column) for each setting. */
export const SETTING_FIELDS: Record<keyof AppSettings, string> = {
  failuresToOpen: "failures_to_open",
  passesToResolve: "passes_to_resolve",
  defaultMaxResponseMs: "default_max_response_ms",
  sslWarningDays: "ssl_warning_days",
  sslFailureDays: "ssl_failure_days",
  backupMaxAgeHours: "backup_max_age_hours",
  minPhpVersion: "min_php_version",
  warnOnUpdates: "warn_on_updates",
  summaryEnabled: "summary_enabled",
  summaryWeekday: "summary_weekday",
  summaryHour: "summary_hour",
};

const PHP_VERSION = /^[5-9]\.\d{1,2}$/;

function inRange(key: NumberKey, value: unknown): value is number {
  const { min, max } = SETTING_LIMITS[key];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Settings from the database row; anything missing or invalid falls back to its default. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): AppSettings {
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  if (!row) return s;
  for (const key of Object.keys(SETTING_LIMITS) as NumberKey[]) {
    const value = row[SETTING_FIELDS[key]];
    if (inRange(key, value)) s[key] = value;
  }
  const php = row.min_php_version;
  if (php === null) s.minPhpVersion = null;
  else if (typeof php === "string" && PHP_VERSION.test(php)) s.minPhpVersion = php;
  for (const key of ["warnOnUpdates", "summaryEnabled"] as const) {
    const value = row[SETTING_FIELDS[key]];
    if (typeof value === "boolean") s[key] = value;
  }
  if (s.sslFailureDays >= s.sslWarningDays) {
    s.sslWarningDays = DEFAULT_SETTINGS.sslWarningDays;
    s.sslFailureDays = DEFAULT_SETTINGS.sslFailureDays;
  }
  return s;
}

export function settingsToRow(s: AppSettings): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(SETTING_FIELDS) as (keyof AppSettings)[]).map((key) => [SETTING_FIELDS[key], s[key]]),
  );
}

export type SettingsFormResult = { ok: true; settings: AppSettings } | { ok: false; field: string; message: string };

const LABELS: Record<NumberKey, string> = {
  failuresToOpen: "Failed checks before an incident",
  passesToResolve: "Passing checks before resolving",
  defaultMaxResponseMs: "Default response time limit",
  sslWarningDays: "SSL warning",
  sslFailureDays: "SSL failure",
  backupMaxAgeHours: "Backup age",
  summaryWeekday: "Summary day",
  summaryHour: "Summary time",
};

/** Validates the Settings form. `get` reads a field by name (FormData.get). */
export function parseSettingsForm(get: (name: string) => unknown): SettingsFormResult {
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(SETTING_LIMITS) as NumberKey[]) {
    const field = SETTING_FIELDS[key];
    const raw = String(get(field) ?? "").trim();
    const value = raw === "" ? NaN : Number(raw);
    if (!inRange(key, value)) {
      const { min, max } = SETTING_LIMITS[key];
      return { ok: false, field, message: `${LABELS[key]} must be a whole number from ${min} to ${max}.` };
    }
    s[key] = value;
  }
  if (s.sslFailureDays >= s.sslWarningDays) {
    return { ok: false, field: SETTING_FIELDS.sslFailureDays, message: "SSL failure must be fewer days than SSL warning." };
  }
  const php = String(get(SETTING_FIELDS.minPhpVersion) ?? "").trim();
  if (php !== "" && !PHP_VERSION.test(php)) {
    return { ok: false, field: SETTING_FIELDS.minPhpVersion, message: 'Minimum PHP must look like "8.2", or be empty to skip the check.' };
  }
  s.minPhpVersion = php === "" ? null : php;
  const on = (name: string) => {
    const v = get(name);
    return v === "on" || v === "true" || v === true;
  };
  s.warnOnUpdates = on(SETTING_FIELDS.warnOnUpdates);
  s.summaryEnabled = on(SETTING_FIELDS.summaryEnabled);
  return { ok: true, settings: s };
}
