// Contact form checks: is there a usable form on the page, whichever tool built
// it (Gravity Forms, Contact Form 7, WPForms, Ninja Forms, Formidable, Elementor,
// HubSpot embeds or plain HTML)? And does the site's email work (from the
// Website Watch plugin)? Pure, so it can be tested. Nothing is ever submitted.
import type { CheckOutcome } from "./evaluate.ts";

export interface FoundForm {
  builder: string;
  /** The builder's form id, when it has one (e.g. Gravity Forms 6). */
  id: string | null;
  /** Visible fields: inputs (not hidden/buttons), textareas and selects. */
  fields: number;
  hasSubmit: boolean;
}

export interface FormEmbed {
  builder: string;
  id: string | null;
  scriptUrl: string | null;
  /** HubSpot: the account the form belongs to, and its data region (na1, eu1...). */
  portalId?: string | null;
  region?: string | null;
}

export interface FormFindings {
  forms: FoundForm[];
  /** Forms drawn by a script after the page loads (HubSpot, Ninja Forms). */
  embeds: FormEmbed[];
  /** Signs the form is broken: "form not found" messages, shortcodes left as text. */
  errors: string[];
  captcha: boolean;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function builderOf(formTag: string): { builder: string; id: string | null } {
  const id = attr(formTag, "id") ?? "";
  const cls = attr(formTag, "class") ?? "";
  if (/^gform_\d+$/.test(id) || /\bgform\b/.test(cls)) {
    return { builder: "Gravity Forms", id: attr(formTag, "data-formid") ?? id.replace("gform_", "") };
  }
  if (/\bwpcf7-form\b/.test(cls)) return { builder: "Contact Form 7", id: null };
  if (/\bwpforms-form\b/.test(cls)) return { builder: "WPForms", id: attr(formTag, "data-formid") };
  if (/\bfrm-show-form\b/.test(cls)) return { builder: "Formidable", id: null };
  if (/\belementor-form\b/.test(cls)) return { builder: "Elementor", id: null };
  return { builder: "HTML form", id: null };
}

function isSearchForm(formTag: string, body: string): boolean {
  const role = attr(formTag, "role") ?? "";
  const idClass = `${attr(formTag, "id") ?? ""} ${attr(formTag, "class") ?? ""}`;
  if (/search/i.test(role) || /search/i.test(idClass)) return true;
  // A form whose only field is "s" (WordPress search) or "q".
  const names = [...body.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => !/type\s*=\s*["']?(hidden|submit|button|image|reset)/i.test(t))
    .map((t) => attr(t, "name"));
  return names.length === 1 && (names[0] === "s" || names[0] === "q");
}

/** Content without scripts, styles and HTML comments (for text checks). */
function visibleText(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ");
}

export function detectForms(html: string): FormFindings {
  const forms: FoundForm[] = [];
  for (const m of html.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi)) {
    const [, tag, body] = m;
    if (isSearchForm(tag, body)) continue;
    const fields = [...body.matchAll(/<(input|textarea|select)\b[^>]*>/gi)].filter(
      (f) => f[1].toLowerCase() !== "input" || !/type\s*=\s*["']?(hidden|submit|button|image|reset)\b/i.test(f[0]),
    ).length;
    const hasSubmit =
      /<input\b[^>]*type\s*=\s*["']?(submit|image)\b/i.test(body) ||
      /<button\b(?![^>]*type\s*=\s*["']?(button|reset)\b)[^>]*>/i.test(body);
    if (fields === 0) continue;
    forms.push({ ...builderOf(tag), fields, hasSubmit });
  }

  const embeds: FormEmbed[] = [];
  const script = html.match(/<script\b[^>]*src\s*=\s*["']((?:https?:)?\/\/js(?:-[a-z0-9]+)?\.hsforms\.net\/forms\/[^"']+)["']/i);
  const scriptUrl = script ? (script[1].startsWith("//") ? `https:${script[1]}` : script[1]) : null;
  // Classic embed: hbspt.forms.create({ portalId, formId, region }).
  for (const m of html.matchAll(/hbspt\.forms\.create\(\s*\{[\s\S]*?\}\s*\)/g)) {
    const value = (key: string) => m[0].match(new RegExp(`${key}\\s*:\\s*["']?([A-Za-z0-9-]+)["']?`))?.[1] ?? null;
    embeds.push({ builder: "HubSpot", id: value("formId"), portalId: value("portalId"), region: value("region"), scriptUrl });
  }
  // Newer embed: <div class="hs-form-frame" data-portal-id data-form-id data-region>.
  for (const m of html.matchAll(/<div\b[^>]*\bhs-form-frame\b[^>]*>/gi)) {
    embeds.push({
      builder: "HubSpot",
      id: attr(m[0], "data-form-id"),
      portalId: attr(m[0], "data-portal-id"),
      region: attr(m[0], "data-region"),
      scriptUrl,
    });
  }
  if (/class\s*=\s*["'][^"']*\bnf-form-cont\b/i.test(html)) {
    embeds.push({ builder: "Ninja Forms", id: html.match(/id\s*=\s*["']nf-form-(\d+)-cont["']/i)?.[1] ?? null, scriptUrl: null });
  }

  const text = visibleText(html);
  const errors: string[] = [];
  if (/\bgform_not_found\b|We could not locate your form/i.test(html)) errors.push("Gravity Forms says it can't find the form");
  if (/\[contact-form-7 404 ["']?Not Found/i.test(text)) errors.push("Contact Form 7 says the form wasn't found");
  const shortcode = text.match(/\[(gravityforms?|contact-form-7|wpforms|ninja_form|formidable)\b[^\]]*\]/i);
  if (shortcode && !errors.length) {
    errors.push(`The form shortcode shows as text (${shortcode[0].slice(0, 60)}): its plugin may be deactivated`);
  }

  return {
    forms,
    embeds,
    errors,
    captcha: /recaptcha|hcaptcha|turnstile/i.test(html),
  };
}

// The site's email, from the Website Watch plugin (1.3+).

export interface MailFailure {
  lastAt: string | null;
  count: number;
  message: string;
}

export interface MailHealth {
  failures: MailFailure[];
  /** Last email WordPress handed off successfully. */
  lastSentAt: string | null;
  /** Daily test email, when an address is set in the plugin. */
  test: { configured: boolean; lastAt: string | null; ok: boolean | null; error: string | null };
}

/** Emails failing in this window make the check fail. */
export const MAIL_FAILURE_WINDOW_HOURS = 24;
/** The daily test email should have run within this time (it relies on WP-Cron). */
export const TEST_EMAIL_STALE_HOURS = 48;

/** HubSpot form: does HubSpot still serve it? */
export interface HubSpotFormStatus {
  id: string;
  /** "missing": HubSpot says it doesn't exist (deleted); "unknown": HubSpot didn't answer. */
  status: "ok" | "missing" | "unpublished" | "unknown";
  fields: number | null;
}

/** HubSpot's public form definition, which its embed script loads (forms-{region}.hsforms.com outside na1). */
export function hubspotDefinitionUrl(embed: FormEmbed): string | null {
  if (embed.builder !== "HubSpot" || !embed.portalId || !embed.id) return null;
  if (!/^\d+$/.test(embed.portalId) || !/^[0-9a-f-]{36}$/i.test(embed.id)) return null;
  const region = embed.region && /^[a-z]{2}\d$/.test(embed.region) && embed.region !== "na1" ? `-${embed.region}` : "";
  return `https://forms${region}.hsforms.com/embed/v3/form/${embed.portalId}/${embed.id}/json`;
}

/** Reads HubSpot's answer: 404 means the form was deleted; the definition says if it's published. */
export function hubspotFormStatus(id: string, httpStatus: number | null, body: unknown): HubSpotFormStatus {
  if (httpStatus === 404) return { id, status: "missing", fields: null };
  const form = (body as { form?: { isPublished?: unknown; formFieldGroups?: unknown } } | null)?.form;
  if (httpStatus !== 200 || !form) return { id, status: "unknown", fields: null };
  const groups = Array.isArray(form.formFieldGroups) ? (form.formFieldGroups as { fields?: unknown }[]) : [];
  const fields = groups.flatMap((g) => (Array.isArray(g.fields) ? (g.fields as { hidden?: unknown }[]) : [])).filter((f) => f.hidden !== true).length;
  return { id, status: form.isPublished === false ? "unpublished" : "ok", fields };
}

export interface FormCheckInput {
  findings: FormFindings;
  /** HubSpot script reachable? null when there's nothing to check. */
  embedScriptOk: boolean | null;
  /** HubSpot forms on the page, as HubSpot reports them. */
  hubspot?: HubSpotFormStatus[];
  mail: MailHealth | null;
  now: Date;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Failed when the form is missing or broken, or the site's email fails; Warning when the test email stopped running. */
export function evaluateForms(input: FormCheckInput, responseTimeMs: number, pageStatus: number): CheckOutcome {
  const base = { http_status: pageStatus, response_time_ms: Math.round(responseTimeMs) };
  const { findings, mail, now } = input;
  const failures: string[] = [...findings.errors];
  const warnings: string[] = [];

  const usable = findings.forms.filter((f) => f.hasSubmit);
  if (usable.length === 0 && findings.embeds.length === 0 && findings.errors.length === 0) {
    failures.push(findings.forms.length > 0 ? "The form on the page has no submit button" : "No contact form found on the page");
  }
  if (input.embedScriptOk === false) failures.push("The form's script doesn't load, so the form can't appear");
  for (const h of input.hubspot ?? []) {
    if (h.status === "missing") failures.push(`HubSpot says form ${h.id.slice(0, 8)}… doesn't exist (deleted?), so it can't appear`);
    if (h.status === "unpublished") failures.push(`HubSpot form ${h.id.slice(0, 8)}… isn't published`);
  }

  if (mail) {
    const hours = (iso: string | null) => (iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : Infinity);
    const recent = mail.failures.filter((f) => hours(f.lastAt) <= MAIL_FAILURE_WINDOW_HOURS);
    if (recent.length > 0) {
      const total = recent.reduce((n, f) => n + f.count, 0);
      failures.push(
        `${plural(total, "email")} from the site failed to send in the last ${MAIL_FAILURE_WINDOW_HOURS} hours (${recent[0].message})`,
      );
    }
    if (mail.test.configured) {
      if (mail.test.ok === false) failures.push(`The daily test email failed to send (${mail.test.error ?? "no reason given"})`);
      else if (hours(mail.test.lastAt) > TEST_EMAIL_STALE_HOURS) {
        warnings.push("The daily test email hasn't run in 2 days (is WP-Cron running?)");
      }
    }
  }

  if (failures.length > 0) {
    return { ...base, status: "failed", passed: false, error_message: [...failures, ...warnings].join("; ") };
  }
  if (warnings.length > 0) return { ...base, status: "warning", passed: false, error_message: warnings.join("; ") };
  return { ...base, status: "passed", passed: true, error_message: null };
}
