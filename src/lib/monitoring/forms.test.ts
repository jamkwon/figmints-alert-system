import { test } from "node:test";
import assert from "node:assert/strict";
import { detectForms, evaluateForms, hubspotDefinitionUrl, hubspotFormStatus, type MailHealth } from "./forms.ts";
import { parsePluginReport } from "./wordpress.ts";
import { pluginSource } from "./wp-plugin.ts";

// Trimmed from www.figmints.com/contact (2026-09-29): a site search form, and
// Gravity Forms #6 (single-quoted attributes) with a honeypot and reCAPTCHA.
const FIGMINTS_CONTACT = `
<form role="search" method="get" id="search-form" class="search-form" action="https://www.figmints.com/" >
  <input type="text" name="s" id="s"><input type="submit" id="searchsubmit" value="Search">
</form>
<div class='gform_wrapper gform_legacy_markup_wrapper' id='gform_wrapper_6'>
<form method='post' enctype='multipart/form-data' target='gform_ajax_frame_6' id='gform_6' action='/contact/#gf_6' data-formid='6' novalidate>
  <input name='input_10' id='input_6_10' type='text' value='' autocomplete='new-password'/>
  <input name='input_1' id='input_6_1' type='text' value='' class='large' aria-required="true"/>
  <input name='input_5' id='input_6_5' type='email' value='' class='large' aria-required="true"/>
  <input name='input_6' id='input_6_6' type='tel' value='' class='large'/>
  <input name='input_3' id='input_6_3' type='text' value='' class='large'/>
  <select name='input_4' id='input_6_4' class='large gfield_select'><option>Web</option></select>
  <textarea name='input_8' id='input_6_8' class='textarea large' rows='10' cols='50'></textarea>
  <input type='submit' id='gform_submit_button_6' class='gform_button button' value='Submit'/>
  <input type='hidden' class='gform_hidden' name='is_submit_6' value='1' />
  <input type='hidden' class='gform_hidden' name='gform_submit' value='6' />
</form></div>
<script src="https://www.google.com/recaptcha/api.js?hl=en&render=explicit"></script>`;

test("figmints.com: the Gravity Form is found, the search form isn't counted", () => {
  const f = detectForms(FIGMINTS_CONTACT);
  assert.deepEqual(f.forms, [{ builder: "Gravity Forms", id: "6", fields: 7, hasSubmit: true }]);
  assert.deepEqual(f.embeds, []);
  assert.deepEqual(f.errors, []);
  assert.equal(f.captcha, true);
  assert.equal(evaluateForms({ findings: f, embedScriptOk: null, mail: null, now: new Date() }, 100, 200).status, "passed");
});

test("other form tools are recognized", () => {
  const cf7 = detectForms(`<form class="wpcf7-form init" method="post"><input name="your-name"><textarea name="your-message"></textarea><input type="submit" value="Send"></form>`);
  assert.equal(cf7.forms[0].builder, "Contact Form 7");
  const wpf = detectForms(`<form id="wpforms-form-12" class="wpforms-validate wpforms-form" data-formid="12"><input name="wpforms[fields][1]"><button type="submit">Send</button></form>`);
  assert.deepEqual(wpf.forms[0], { builder: "WPForms", id: "12", fields: 1, hasSubmit: true });
  const el = detectForms(`<form class="elementor-form" method="post"><input name="form_fields[email]" type="email"><button>Send</button></form>`);
  assert.deepEqual(el.forms[0], { builder: "Elementor", id: null, fields: 1, hasSubmit: true }, "a button with no type submits");
  const plain = detectForms(`<form action="/send"><input name="email"><button type="button">Nope</button></form>`);
  assert.equal(plain.forms[0].hasSubmit, false, "type=button doesn't submit");
});

test("forms drawn by scripts: HubSpot (with its script) and Ninja Forms", () => {
  const hs = detectForms(`<script charset="utf-8" type="text/javascript" src="//js.hsforms.net/forms/embed/v2.js"></script>
    <script>hbspt.forms.create({ region: "na1", portalId: "313824", formId: "a1b2c3d4-0000-4000-8000-123456789abc" });</script>`);
  assert.deepEqual(hs.embeds, [
    {
      builder: "HubSpot",
      id: "a1b2c3d4-0000-4000-8000-123456789abc",
      portalId: "313824",
      region: "na1",
      scriptUrl: "https://js.hsforms.net/forms/embed/v2.js",
    },
  ]);
  assert.equal(evaluateForms({ findings: hs, embedScriptOk: true, mail: null, now: new Date() }, 1, 200).status, "passed");
  assert.equal(evaluateForms({ findings: hs, embedScriptOk: false, mail: null, now: new Date() }, 1, 200).status, "failed");
  const nf = detectForms(`<div id="nf-form-3-cont" class="nf-form-cont" aria-live="polite"></div>`);
  assert.deepEqual(nf.embeds, [{ builder: "Ninja Forms", id: "3", scriptUrl: null }]);
});

test("broken forms fail: missing form, 'form not found', shortcodes left as text", () => {
  const now = new Date();
  const check = (html: string) => evaluateForms({ findings: detectForms(html), embedScriptOk: null, mail: null, now }, 1, 200);
  assert.equal(check(`<p>Call us!</p>`).error_message, "No contact form found on the page");
  assert.equal(check(`<form role="search"><input name="s"><button>Go</button></form>`).error_message, "No contact form found on the page");
  assert.match(check(`<div class='gform_not_found'>Oops! We could not locate your form.</div>`).error_message!, /can't find the form/);
  assert.match(check(`<p>[contact-form-7 404 "Not Found"]</p>`).error_message!, /Contact Form 7/);
  assert.match(check(`<p>[gravityform id="6" title="false"]</p>`).error_message!, /shortcode shows as text.*deactivated/);
  assert.equal(check(`<script>var x = "[gravityform id=6]";</script><form><input name="a"><button>Send</button></form>`).status, "passed", "code isn't page text");
  assert.equal(check(`<form><input name="email"></form>`).error_message, "The form on the page has no submit button");
});

const now = new Date("2026-09-29T15:00:00Z");
const okMail: MailHealth = {
  failures: [],
  lastSentAt: "2026-09-29T14:00:00Z",
  test: { configured: true, lastAt: "2026-09-29T09:00:00Z", ok: true, error: null },
};

test("site email: recent failures and a failed test email fail; a stalled test warns", () => {
  const findings = detectForms(FIGMINTS_CONTACT);
  const run = (mail: MailHealth) => evaluateForms({ findings, embedScriptOk: null, mail, now }, 1, 200);
  assert.equal(run(okMail).status, "passed");
  const failing = run({ ...okMail, failures: [{ lastAt: "2026-09-29T12:00:00Z", count: 3, message: "SMTP Error: Could not authenticate." }] });
  assert.equal(failing.status, "failed");
  assert.equal(failing.error_message, "3 emails from the site failed to send in the last 24 hours (SMTP Error: Could not authenticate.)");
  assert.equal(run({ ...okMail, failures: [{ lastAt: "2026-09-25T12:00:00Z", count: 1, message: "old" }] }).status, "passed", "older than a day");
  assert.match(run({ ...okMail, test: { ...okMail.test, ok: false, error: "Could not instantiate mail function." } }).error_message!, /daily test email failed/);
  assert.equal(run({ ...okMail, test: { ...okMail.test, lastAt: "2026-09-26T09:00:00Z" } }).status, "warning");
  assert.equal(run({ ...okMail, test: { configured: false, lastAt: null, ok: null, error: null } }).status, "passed", "no test email set");
});

test("the plugin report's email section is read, and missing before plugin 1.3", () => {
  const base = { wordpress: { version: "7.1.2" }, plugins: [] };
  assert.equal(parsePluginReport(base)!.mail, null);
  const r = parsePluginReport({
    ...base,
    mail: {
      failures: [{ last_at: "2026-09-29T15:37:35+00:00", count: 2, message: "Could not instantiate mail function." }, { message: "" }],
      last_sent_at: "2026-09-29T15:37:36+00:00",
      test: { configured: true, last_at: "2026-09-29T15:37:35+00:00", ok: false, error: "Could not instantiate mail function." },
    },
  })!;
  assert.deepEqual(r.mail, {
    failures: [{ lastAt: "2026-09-29T15:37:35+00:00", count: 2, message: "Could not instantiate mail function." }],
    lastSentAt: "2026-09-29T15:37:36+00:00",
    test: { configured: true, lastAt: "2026-09-29T15:37:35+00:00", ok: false, error: "Could not instantiate mail function." },
  });
});

test("the plugin file carries the test email address, and only a plain one", () => {
  const key = "A".repeat(43) + "=";
  assert.ok(pluginSource(key).includes("define('WEBSITE_WATCH_TEST_EMAIL', '');"), "off by default");
  assert.ok(pluginSource(key, "websitewatch@figmints.com").includes("define('WEBSITE_WATCH_TEST_EMAIL', 'websitewatch@figmints.com');"));
  assert.throws(() => pluginSource(key, "x'); system('id'); //@a.com"), "nothing but an address gets into the PHP");
});

test("HubSpot's newer embed code is recognized too", () => {
  const f = detectForms(`<script src="https://js.hsforms.net/forms/embed/313824.js" defer></script>
    <div class="hs-form-frame" data-region="eu1" data-form-id="0e83528b-bdbb-47b7-aa75-1080839e08a7" data-portal-id="313824"></div>`);
  assert.deepEqual(f.embeds, [
    {
      builder: "HubSpot",
      id: "0e83528b-bdbb-47b7-aa75-1080839e08a7",
      portalId: "313824",
      region: "eu1",
      scriptUrl: "https://js.hsforms.net/forms/embed/313824.js",
    },
  ]);
});

test("HubSpot form definition address: the embed's portal, form and region", () => {
  const form = { builder: "HubSpot", id: "0e83528b-bdbb-47b7-aa75-1080839e08a7", portalId: "53", region: "na1", scriptUrl: null };
  assert.equal(hubspotDefinitionUrl(form), "https://forms.hsforms.com/embed/v3/form/53/0e83528b-bdbb-47b7-aa75-1080839e08a7/json");
  assert.equal(hubspotDefinitionUrl({ ...form, region: "eu1" }), "https://forms-eu1.hsforms.com/embed/v3/form/53/0e83528b-bdbb-47b7-aa75-1080839e08a7/json");
  assert.equal(hubspotDefinitionUrl({ ...form, portalId: null }), null, "no portal, nothing to ask");
  assert.equal(hubspotDefinitionUrl({ ...form, portalId: "53/../x" }), null, "only real ids go into the address");
  assert.equal(hubspotDefinitionUrl({ ...form, region: "evil.example" }), "https://forms.hsforms.com/embed/v3/form/53/0e83528b-bdbb-47b7-aa75-1080839e08a7/json");
});

test("HubSpot's answer: live, deleted (404), unpublished, or no answer", () => {
  const id = "0e83528b-bdbb-47b7-aa75-1080839e08a7";
  // Trimmed from HubSpot's real answers, 2026-09-29.
  const live = { form: { portalId: 53, guid: id, isPublished: true, formFieldGroups: [{ fields: [{ name: "email" }, { name: "firstname" }] }, { fields: [{ name: "gaclientid", hidden: true }] }] }, errorCode: null };
  assert.deepEqual(hubspotFormStatus(id, 200, live), { id, status: "ok", fields: 2 });
  assert.deepEqual(hubspotFormStatus(id, 404, { status: "error", message: "resource not found" }), { id, status: "missing", fields: null });
  assert.equal(hubspotFormStatus(id, 200, { form: { ...live.form, isPublished: false } }).status, "unpublished");
  assert.equal(hubspotFormStatus(id, 503, null).status, "unknown");
  assert.equal(hubspotFormStatus(id, null, null).status, "unknown");

  const findings = detectForms(`<script>hbspt.forms.create({ portalId: "53", formId: "${id}" });</script>`);
  const run = (hubspot: ReturnType<typeof hubspotFormStatus>[]) =>
    evaluateForms({ findings, embedScriptOk: null, hubspot, mail: null, now: new Date() }, 1, 200);
  assert.equal(run([{ id, status: "ok", fields: 2 }]).status, "passed");
  assert.match(run([{ id, status: "missing", fields: null }]).error_message!, /HubSpot says form 0e83528b… doesn't exist/);
  assert.match(run([{ id, status: "unpublished", fields: null }]).error_message!, /isn't published/);
  assert.equal(run([{ id, status: "unknown", fields: null }]).status, "passed", "HubSpot not answering isn't the site's fault");
});

test("a hostile page can't make stored results huge", () => {
  const many = Array.from({ length: 50 }, (_, i) => `<form><input name="f${i}"><button>Send</button></form>`).join("");
  assert.equal(detectForms(many).forms.length, 20);
  const long = detectForms(`<div class="hs-form-frame" data-portal-id="1" data-form-id="${"a".repeat(5000)}"></div>`);
  assert.equal(long.embeds[0].id!.length, 64);
});
