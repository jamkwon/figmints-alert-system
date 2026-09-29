"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getStaffUser, isStaffRequest } from "@/lib/auth/session";
import { logIncidentEvent } from "@/lib/monitoring/incident-events";
import { notifyIncidentChange } from "@/lib/notify/send";
import { detectTrackingOnPage } from "@/lib/monitoring/run-check";
import { MAINTENANCE_HOURS } from "@/lib/labels";
import { MAX_IMPORT, buildCandidates, monitorsForImport } from "@/lib/monitoring/wpengine-import";
import { listInstalls, listSites } from "@/lib/monitoring/wpengine";
import { parseSettingsForm } from "@/lib/settings";
import { saveSettings } from "@/lib/settings-store";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Monitor, Website } from "@/lib/types";
import {
  ValidationError,
  parseBulkLines,
  parseCheckbox,
  parseEnvironment,
  parseExpectedTags,
  parseExpectedText,
  parseInterval,
  parseMonitorType,
  nameFromUrl,
  parseName,
  parseNotes,
  parseOptionalInt,
  parseSeverity,
  parseUrl,
  resolveMonitorUrl,
  type BulkMonitorLine,
} from "@/lib/validation";

// Create/edit clients, websites and monitors. Every action checks the signed-in
// user, validates on the server (URLs use the same SSRF rules as checks), and
// only touches rows by ID.

export interface FormState {
  ok: boolean;
  message?: string;
  field?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFrom(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** Shared guard + error handling. `run` returns a path to redirect to on success. */
async function handle(run: () => Promise<string>): Promise<FormState> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Connect Supabase to make changes." };
  if (!(await isStaffRequest())) return { ok: false, message: "Your session has ended. Sign in again." };
  let destination: string;
  try {
    destination = await run();
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, message: err.message, field: err.field };
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
  redirect(destination);
}

function fail(action: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`Could not ${action}: ${error.message}`);
}

async function insertMonitors(
  websiteId: string,
  lines: BulkMonitorLine[],
  interval: number,
  severity: Monitor["severity_on_failure"],
) {
  if (lines.length === 0) return;
  const { error } = await getSupabase()
    .from("monitors")
    .insert(
      lines.map((line) => ({
        website_id: websiteId,
        name: line.name,
        monitor_type: line.expected_text ? "expected_content" : "http_status",
        target_url: line.target_url,
        expected_text: line.expected_text,
        interval_minutes: interval,
        severity_on_failure: severity,
        // Due immediately: the next scheduler run checks it.
        next_check_at: null,
      })),
    );
  fail("add monitors", error);
}

/** Adds an SSL certificate monitor for the website, unless it already has one. */
async function addSslMonitor(websiteId: string, websiteUrl: string, severity: Monitor["severity_on_failure"]) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "ssl_expiry")
    .limit(1);
  fail("check SSL monitors", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "SSL Certificate",
    monitor_type: "ssl_expiry",
    target_url: new URL(websiteUrl).origin + "/",
    // Certificates change slowly; every 6 hours is plenty.
    interval_minutes: 360,
    severity_on_failure: severity,
    next_check_at: null,
  });
  fail("add SSL monitor", error);
}

/** Adds a daily broken link scan of the website's homepage, unless it already has one. */
async function addLinkScanMonitor(websiteId: string, websiteUrl: string) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "broken_links")
    .limit(1);
  fail("check link scans", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "Broken Links (Homepage)",
    monitor_type: "broken_links",
    target_url: new URL(websiteUrl).origin + "/",
    // A scan makes up to 40 requests; once a day keeps it polite and cheap.
    interval_minutes: 1440,
    severity_on_failure: "warning",
    next_check_at: null,
  });
  fail("add link scan", error);
}

/**
 * Adds a tracking tag check for the homepage that expects whatever tags are
 * there right now, unless the website already has one. If nothing is found (or
 * the page can't load), it's added with no expectations; edit it to choose tags.
 */
async function addTrackingMonitor(websiteId: string, websiteUrl: string) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "tracking_tags")
    .limit(1);
  fail("check tracking monitors", existing.error);
  if (existing.data?.length) return;
  const target = new URL(websiteUrl).origin + "/";
  let expected: string[] = [];
  try {
    expected = Object.keys((await detectTrackingOnPage(target)).found);
  } catch {
    // Page unreachable right now; the monitor still gets created.
  }
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "Tracking Tags (Homepage)",
    monitor_type: "tracking_tags",
    target_url: target,
    expected_tags: expected,
    interval_minutes: 360,
    severity_on_failure: "warning",
    next_check_at: null,
  });
  fail("add tracking check", error);
}

/** Adds a WordPress health check for the website, unless it already has one. */
async function addWordPressMonitor(websiteId: string, websiteUrl: string) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "wordpress_health")
    .limit(1);
  fail("check WordPress monitors", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "WordPress Health",
    monitor_type: "wordpress_health",
    target_url: new URL(websiteUrl).origin + "/",
    // Every 6 hours catches a failed nightly backup the same day.
    interval_minutes: 360,
    severity_on_failure: "critical",
    next_check_at: null,
  });
  fail("add WordPress check", error);
}

/** Adds a check that search engines can index the homepage, unless it already has one. Production only. */
async function addVisibilityMonitor(websiteId: string, websiteUrl: string, environment: Website["environment"]) {
  // Staging sites are meant to be hidden from search engines.
  if (environment !== "production") return;
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "search_visibility")
    .limit(1);
  fail("check search visibility monitors", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "Search Visibility",
    monitor_type: "search_visibility",
    target_url: new URL(websiteUrl).origin + "/",
    // Every 6 hours catches a noindex pushed from staging the same day.
    interval_minutes: 360,
    severity_on_failure: "critical",
    next_check_at: null,
  });
  fail("add search visibility check", error);
}

/** Adds a daily domain expiry check, unless the website already has one. */
async function addDomainMonitor(websiteId: string, websiteUrl: string) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "domain_expiry")
    .limit(1);
  fail("check domain monitors", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "Domain Expiry",
    monitor_type: "domain_expiry",
    target_url: new URL(websiteUrl).origin + "/",
    interval_minutes: 1440,
    severity_on_failure: "critical",
    next_check_at: null,
  });
  fail("add domain check", error);
}

/** Adds a daily Google PageSpeed test of the homepage, unless the website already has one. */
async function addPageSpeedMonitor(websiteId: string, websiteUrl: string) {
  const db = getSupabase();
  const existing = await db
    .from("monitors")
    .select("id")
    .eq("website_id", websiteId)
    .eq("monitor_type", "page_speed")
    .limit(1);
  fail("check page speed monitors", existing.error);
  if (existing.data?.length) return;
  const { error } = await db.from("monitors").insert({
    website_id: websiteId,
    name: "Page Speed (Homepage)",
    monitor_type: "page_speed",
    target_url: new URL(websiteUrl).origin + "/",
    interval_minutes: 1440,
    // Page speed only warns; severity applies to nothing, so keep it low.
    severity_on_failure: "warning",
    next_check_at: null,
  });
  fail("add page speed check", error);
}

// Clients ---------------------------------------------------------------------

export async function saveClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const id = idFrom(formData, "id");
    const name = parseName(formData.get("name"));
    const primaryWebsite = parseUrl(formData.get("primary_website"), "primary_website", false);
    const notes = parseNotes(formData.get("notes"));
    const db = getSupabase();

    if (id) {
      const { error } = await db
        .from("clients")
        .update({ name, primary_website: primaryWebsite, notes, active: parseCheckbox(formData.get("active")) })
        .eq("id", id);
      fail("save client", error);
      return `/clients/${id}`;
    }

    // Parse everything before writing anything, so a bad line doesn't leave half a client.
    const pages = primaryWebsite ? parseBulkLines(primaryWebsite, String(formData.get("pages") ?? "")) : [];
    const interval = parseInterval(formData.get("interval_minutes") ?? 15);
    const severity = parseSeverity(formData.get("severity_on_failure") ?? "critical");

    const client = await db.from("clients").insert({ name, primary_website: primaryWebsite, notes }).select("id").single();
    fail("create client", client.error);
    if (primaryWebsite) {
      const website = await db
        .from("websites")
        .insert({ client_id: client.data!.id, name: "Main site", url: primaryWebsite, environment: "production" })
        .select("id")
        .single();
      fail("create website", website.error);
      await insertMonitors(website.data!.id, pages, interval, severity);
      if (parseCheckbox(formData.get("ssl"))) await addSslMonitor(website.data!.id, primaryWebsite, severity);
      if (parseCheckbox(formData.get("links"))) await addLinkScanMonitor(website.data!.id, primaryWebsite);
      if (parseCheckbox(formData.get("tags"))) await addTrackingMonitor(website.data!.id, primaryWebsite);
      if (parseCheckbox(formData.get("wordpress"))) await addWordPressMonitor(website.data!.id, primaryWebsite);
      if (parseCheckbox(formData.get("visibility"))) {
        await addVisibilityMonitor(website.data!.id, primaryWebsite, "production");
      }
      if (parseCheckbox(formData.get("domain"))) await addDomainMonitor(website.data!.id, primaryWebsite);
      if (parseCheckbox(formData.get("speed"))) await addPageSpeedMonitor(website.data!.id, primaryWebsite);
    }
    return `/clients/${client.data!.id}`;
  });
}

// Websites --------------------------------------------------------------------

export async function saveWebsiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const id = idFrom(formData, "id");
    const clientId = idFrom(formData, "client_id");
    if (!clientId) throw new Error("Unknown client.");
    const fields = {
      name: parseName(formData.get("name")),
      url: parseUrl(formData.get("url"))!,
      environment: parseEnvironment(formData.get("environment")),
    };
    const db = getSupabase();
    if (id) {
      const { error } = await db
        .from("websites")
        .update({ ...fields, active: parseCheckbox(formData.get("active")) })
        .eq("id", id)
        .eq("client_id", clientId);
      fail("save website", error);
    } else {
      const { error } = await db.from("websites").insert({ ...fields, client_id: clientId });
      fail("add website", error);
    }
    return `/clients/${clientId}`;
  });
}

/** Starts (hours > 0) or ends (hours = 0) a maintenance window on a website. */
export async function setMaintenanceAction(websiteId: string, hours: number, note: string): Promise<FormState> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Connect Supabase to make changes." };
  if (!(await isStaffRequest())) return { ok: false, message: "Your session has ended. Sign in again." };
  if (typeof websiteId !== "string" || !UUID.test(websiteId)) return { ok: false, message: "Unknown website." };
  if (hours !== 0 && !MAINTENANCE_HOURS.includes(hours as (typeof MAINTENANCE_HOURS)[number])) {
    return { ok: false, message: "Choose a maintenance length." };
  }
  let cleanNote: string;
  try {
    cleanNote = parseNotes(typeof note === "string" ? note : "", "maintenance_note");
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Invalid note." };
  }
  const { error } = await getSupabase()
    .from("websites")
    .update({
      maintenance_until: hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
      maintenance_note: hours === 0 ? "" : cleanNote,
    })
    .eq("id", websiteId);
  if (error) return { ok: false, message: `Could not update maintenance: ${error.message}` };
  refresh();
  return { ok: true, message: hours === 0 ? "Maintenance ended." : "Maintenance started." };
}

// Monitors --------------------------------------------------------------------

async function loadWebsite(websiteId: string): Promise<Pick<Website, "id" | "url" | "client_id" | "environment">> {
  const { data, error } = await getSupabase()
    .from("websites")
    .select("id, url, client_id, environment")
    .eq("id", websiteId)
    .maybeSingle();
  fail("load website", error);
  if (!data) throw new Error("Unknown website.");
  return data;
}

/** Adds several monitors at once to one website (one page per line). */
export async function addMonitorsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const websiteId = idFrom(formData, "website_id");
    if (!websiteId) throw new ValidationError("website_id", "Choose a website.");
    const website = await loadWebsite(websiteId);
    const lines = parseBulkLines(website.url, String(formData.get("pages") ?? ""));
    const ssl = parseCheckbox(formData.get("ssl"));
    const linkScan = parseCheckbox(formData.get("links"));
    const tags = parseCheckbox(formData.get("tags"));
    const wordpress = parseCheckbox(formData.get("wordpress"));
    const visibility = parseCheckbox(formData.get("visibility"));
    const domain = parseCheckbox(formData.get("domain"));
    const speed = parseCheckbox(formData.get("speed"));
    if (lines.length === 0 && !ssl && !linkScan && !tags && !wordpress && !visibility && !domain && !speed) {
      throw new ValidationError("pages", "Add at least one page, or tick one of the extra checks.");
    }
    const severity = parseSeverity(formData.get("severity_on_failure"));
    await insertMonitors(website.id, lines, parseInterval(formData.get("interval_minutes")), severity);
    if (ssl) await addSslMonitor(website.id, website.url, severity);
    if (linkScan) await addLinkScanMonitor(website.id, website.url);
    if (tags) await addTrackingMonitor(website.id, website.url);
    if (wordpress) await addWordPressMonitor(website.id, website.url);
    if (visibility) await addVisibilityMonitor(website.id, website.url, website.environment);
    if (domain) await addDomainMonitor(website.id, website.url);
    if (speed) await addPageSpeedMonitor(website.id, website.url);
    return `/clients/${website.client_id}`;
  });
}

/** Validates the monitor settings shared by create and edit. */
function parseMonitorFields(formData: FormData, websiteUrl: string) {
  const monitorType = parseMonitorType(formData.get("monitor_type"));
  // SSL, link scans and tag checks have their own rules; expected status/text don't apply.
  const ownRules =
    monitorType === "ssl_expiry" ||
    monitorType === "broken_links" ||
    monitorType === "tracking_tags" ||
    monitorType === "wordpress_health" ||
    monitorType === "search_visibility" ||
    monitorType === "domain_expiry" ||
    monitorType === "page_speed";
  const expectedTags = monitorType === "tracking_tags" ? parseExpectedTags(formData.getAll("expected_tags")) : [];
  const expectedText = ownRules ? null : parseExpectedText(formData.get("expected_text"));
  if (monitorType === "expected_content" && !expectedText) {
    throw new ValidationError("expected_text", "Expected Content monitors need the text to look for.");
  }
  const targetUrl = resolveMonitorUrl(websiteUrl, String(formData.get("target_url") ?? ""));
  return {
    monitor_type: monitorType,
    target_url: targetUrl,
    expected_status_code: ownRules
      ? null
      : parseOptionalInt(formData.get("expected_status_code"), "expected_status_code", "Expected status", 100, 599),
    expected_text: expectedText,
    expected_tags: expectedTags,
    max_response_time_ms:
      monitorType === "response_time"
        ? parseOptionalInt(formData.get("max_response_time_ms"), "max_response_time_ms", "Max response time", 100, 60000)
        : null,
    interval_minutes: parseInterval(formData.get("interval_minutes")),
    severity_on_failure: parseSeverity(formData.get("severity_on_failure")),
    active: parseCheckbox(formData.get("active")),
  };
}

/** Creates one monitor with all its settings. */
export async function createMonitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const websiteId = idFrom(formData, "website_id");
    if (!websiteId) throw new ValidationError("website_id", "Choose a website.");
    const website = await loadWebsite(websiteId);
    const fields = parseMonitorFields(formData, website.url);
    // Name is optional here; default to one based on the page.
    const rawName = String(formData.get("name") ?? "").trim();
    const name = rawName
      ? parseName(rawName)
      : fields.monitor_type === "ssl_expiry"
        ? "SSL Certificate"
        : nameFromUrl(fields.target_url);
    const { data, error } = await getSupabase()
      .from("monitors")
      .insert({ ...fields, name, website_id: website.id, next_check_at: null })
      .select("id")
      .single();
    fail("add monitor", error);
    return `/monitors/${data!.id}`;
  });
}

export async function saveMonitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const id = idFrom(formData, "id");
    if (!id) throw new Error("Unknown monitor.");
    const db = getSupabase();
    const existing = await db.from("monitors").select("website_id, active, interval_minutes").eq("id", id).maybeSingle();
    fail("load monitor", existing.error);
    if (!existing.data) throw new Error("Unknown monitor.");
    const website = await loadWebsite(existing.data.website_id);
    const fields = parseMonitorFields(formData, website.url);
    const { error } = await db
      .from("monitors")
      .update({
        ...fields,
        name: parseName(formData.get("name")),
        // Resuming a paused monitor, or changing how often it runs, makes it due right
        // away (otherwise a daily → 5 minute change would wait out the old day).
        ...(fields.active && (!existing.data.active || fields.interval_minutes !== existing.data.interval_minutes)
          ? { next_check_at: null }
          : {}),
      })
      .eq("id", id);
    fail("save monitor", error);
    if (!fields.active && existing.data.active) await closeIncidentsOfPausedMonitor(id);
    return `/monitors/${id}`;
  });
}

/**
 * A paused monitor isn't checked, so its open incident would never resolve by
 * itself: close it, noting why.
 */
async function closeIncidentsOfPausedMonitor(monitorId: string): Promise<void> {
  const actor = (await getStaffUser())?.email ?? "staff";
  const { data, error } = await getSupabase()
    .from("incidents")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), snoozed_until: null })
    .eq("monitor_id", monitorId)
    .is("resolved_at", null)
    .select("id");
  fail("close incidents", error);
  for (const { id } of data ?? []) {
    await logIncidentEvent(id, actor, "resolved", "Closed because the monitor was paused");
    await notifyIncidentChange("resolved", id, actor);
  }
}

// Import from WP Engine ------------------------------------------------------------

/** Creates clients, websites and monitors for the ticked WP Engine installs. */
export async function importFromWpeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const ids = new Set(formData.getAll("install").map(String));
    if (ids.size === 0) throw new ValidationError("install", "Tick at least one site to import.");
    if (ids.size > MAX_IMPORT) throw new ValidationError("install", `Import at most ${MAX_IMPORT} sites at a time.`);
    const uptime = parseCheckbox(formData.get("uptime"));
    const ssl = parseCheckbox(formData.get("ssl"));
    const wordpress = parseCheckbox(formData.get("wordpress"));
    if (!uptime && !ssl && !wordpress) throw new ValidationError("checks", "Choose at least one check to add.");
    const interval = parseInterval(formData.get("interval_minutes") ?? 15);
    const severity = parseSeverity(formData.get("severity_on_failure") ?? "critical");

    // Domains come from WP Engine again, never from the form.
    const db = getSupabase();
    const [installs, sites, websites, clients] = await Promise.all([
      listInstalls(),
      listSites(),
      fetchAllRows((from, to) => db.from("websites").select("url, client_id").order("id").range(from, to)),
      fetchAllRows((from, to) => db.from("clients").select("id, name").order("id").range(from, to)),
    ]);
    fail("load websites", websites.error);
    fail("load clients", clients.error);
    const clientNames = new Map(clients.data!.map((c) => [c.id as string, c.name as string]));
    const candidates = buildCandidates(
      installs,
      sites,
      websites.data!.map((w) => ({ url: w.url as string, clientName: clientNames.get(w.client_id as string) ?? "" })),
      [...clientNames.values()],
    );
    const chosen = candidates.filter((c) => ids.has(c.installId) && !c.monitoredBy);
    if (chosen.length === 0) throw new ValidationError("install", "Those sites are already monitored.");

    // Validate every name and URL before writing anything.
    const rows = chosen.map((c) => {
      const name = parseName(formData.get(`name_${c.installId}`) ?? c.siteName, "name", `Client name for ${c.domain}`);
      return { key: name.toLowerCase(), name, url: parseUrl(c.url)! };
    });

    // Clients: reuse one with the same name, otherwise create it.
    const clientIds = new Map([...clientNames].map(([id, name]) => [name.trim().toLowerCase(), id]));
    const newClients = new Map(rows.filter((r) => !clientIds.has(r.key)).map((r) => [r.key, r]));
    if (newClients.size) {
      const created = await db
        .from("clients")
        .insert([...newClients.values()].map((r) => ({ name: r.name, primary_website: r.url })))
        .select("id, name");
      fail("create clients", created.error);
      for (const c of created.data!) clientIds.set((c.name as string).trim().toLowerCase(), c.id as string);
    }

    const created = await db
      .from("websites")
      .insert(
        rows.map((r) => ({ client_id: clientIds.get(r.key)!, name: "Main site", url: r.url, environment: "production" })),
      )
      .select("id, url");
    fail("create websites", created.error);

    const checks = { uptime, ssl, wordpress, interval, severity };
    const now = Date.now();
    const monitors = created.data!.flatMap((w) => monitorsForImport({ id: w.id as string, url: w.url as string }, checks, now));
    const { error } = await db.from("monitors").insert(monitors);
    fail("add monitors", error);
    return `/wpengine?imported=${created.data!.length}`;
  });
}

// Settings ----------------------------------------------------------------------------

/** Saves the editable monitoring rules (Settings). */
export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return handle(async () => {
    const parsed = parseSettingsForm((name) => formData.get(name));
    if (!parsed.ok) throw new ValidationError(parsed.field, parsed.message);
    const actor = (await getStaffUser())?.email ?? "staff";
    await saveSettings(parsed.settings, actor);
    return "/settings?saved=1";
  });
}
