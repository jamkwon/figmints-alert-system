import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Fragment, type ReactNode } from "react";
import { RunDueChecksButton } from "@/components/run-due-checks-button";
import { TestAlertButton } from "@/components/test-alert-button";
import { HealthBadge } from "@/components/status";
import { Panel, PageHeader, When } from "@/components/ui";
import { getDataSource, getLastWeeklySummary, getSchedulerStatus } from "@/lib/data";
import { SUMMARY_SSL_DAYS } from "@/lib/notify/weekly";
import { SettingsForm } from "@/components/settings-form";
import { WEEKDAY_NAMES } from "@/lib/settings";
import { getSettingsInfo } from "@/lib/settings-store";
import { APP_TIMEZONE } from "@/lib/format";
import { allowedDomains } from "@/lib/auth/session";
import { MAX_LINKS } from "@/lib/monitoring/links";
import { checkWpeConnection } from "@/lib/monitoring/wpengine";
import { WP_PLUGIN_VERSION, WP_PLUGIN_ZIP, pluginKey } from "@/lib/monitoring/wp-plugin";
import { RETENTION_DAYS } from "@/lib/monitoring/scheduler";
import { appUrl, slackWebhookUrl } from "@/lib/notify/send";
import { supabaseEnvStatus } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };
// Allows the "Run due checks now" action to run a full batch.
export const maxDuration = 60;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[16rem_1fr] gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-fig-ink">{children}</dd>
    </div>
  );
}

function EnvStatus({ found, options }: { found: string | null; options: readonly string[] }) {
  if (found) {
    return (
      <span className="flex items-center gap-2">
        <HealthBadge health="healthy" label="Set" />
        <code className="text-xs text-slate-600">{found}</code>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <HealthBadge health="unknown" label="Not set" />
      <span className="text-xs text-slate-500">
        Looked for{" "}
        {options.map((o, i) => (
          <Fragment key={o}>
            {i > 0 && " or "}
            <code>{o}</code>
          </Fragment>
        ))}
      </span>
    </span>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const saved = (await searchParams).saved === "1";
  const settingsInfo = await getSettingsInfo();
  const rules = settingsInfo.settings;
  const source = getDataSource();
  const env = supabaseEnvStatus();
  const cronSecretSet = (process.env.CRON_SECRET?.length ?? 0) >= 16;

  const { dueNow, nextDue, lastCheck } = await getSchedulerStatus();
  const slackConfigured = slackWebhookUrl() !== null;
  const lastSummary = await getLastWeeklySummary();
  const pluginKeySet = pluginKey() !== null;
  const wpe = source === "sample" ? { ok: false, message: "Not configured" } : await checkWpeConnection();
  const alertLinkBase = appUrl();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Monitoring rules can be changed here. Connections (Supabase, Slack, WP Engine) are set with environment variables."
      />

      <Panel title="Data source" className="mb-6">
        <dl>
          <Row label="Currently using">
            {source === "supabase" ? (
              <HealthBadge health="healthy" label="Supabase" />
            ) : (
              <HealthBadge health="warning" label="Built-in sample data" />
            )}
          </Row>
          <Row label="Supabase project URL">
            <EnvStatus found={env.url} options={env.urlOptions} />
          </Row>
          <Row label="Supabase secret key">
            <EnvStatus found={env.secretKey} options={env.secretKeyOptions} />
          </Row>
          <Row label="Supabase login key">
            <EnvStatus found={env.publicKey} options={env.publicKeyOptions} />
          </Row>
          <Row label="Who can sign in">
            Google accounts ending in{" "}
            {allowedDomains().map((d, i) => (
              <Fragment key={d}>
                {i > 0 && ", "}
                <strong>@{d}</strong>
              </Fragment>
            ))}
            {source === "sample" && <span className="text-slate-500"> (login is off on sample data)</span>}
          </Row>
        </dl>
        {source === "sample" && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Set both in <code>.env.local</code> (or connect the Supabase integration on Vercel) and restart the server
            to use Supabase. See the README.
          </p>
        )}
      </Panel>

      {saved && (
        <p role="status" className="mb-6 rounded-md bg-fig-teal/10 px-3 py-2 text-sm text-fig-ink">
          Settings saved. Checks use them within about 30 seconds.
        </p>
      )}

      <Panel
        title="Monitoring rules"
        aside={
          settingsInfo.updatedBy && settingsInfo.updatedAt ? (
            <>
              Last changed by {settingsInfo.updatedBy}, <When iso={settingsInfo.updatedAt} />
            </>
          ) : null
        }
      >
        <SettingsForm
          settings={rules}
          disabledReason={
            source === "sample"
              ? "Connect Supabase to change these."
              : !settingsInfo.stored
                ? "Run the migration 20261002000000_app_settings.sql in Supabase to change these (defaults apply until then)."
                : undefined
          }
        />
      </Panel>

      <Panel title="Fixed rules" className="mt-6">
        <dl>
          <Row label="Incident severity">
            From the monitor; slow responses are at most Warning
          </Row>
          <Row label="Default HTTP success">Status 200–399 (unless a monitor sets an expected status)</Row>
          <Row label="Display timezone">{APP_TIMEZONE}</Row>
          <Row label="Check intervals">5 min, 15 min, 30 min, 1 hour, 6 hours, daily, weekly, monthly (every 30 days)</Row>
          <Row label="Tracking tags">
            Looks for Google Tag Manager, GA4, Google Ads, Meta Pixel, LinkedIn Insight and HubSpot in the page&apos;s HTML;
            fails when an expected tag is missing. Tags loaded inside GTM aren&apos;t visible without a browser.
          </Row>
          <Row label="Broken link scans">
            Up to {MAX_LINKS} links per page (same-site first), daily by default. Broken = 404, 410, 5xx, unknown domain
            or refused connection; anything that just blocks or rate-limits checkers is ignored. Found broken links raise
            a Warning.
          </Row>
          <Row label="Snooze options">1 hour, 4 hours, 24 hours, 7 days <span className="text-slate-500">(reopens automatically)</span></Row>
          <Row label="Check history kept">{RETENTION_DAYS} days <span className="text-slate-500">(older results are deleted hourly)</span></Row>
        </dl>
      </Panel>

      <Panel title="Alerts" className="mt-6">
        <dl>
          <Row label="Slack">
            {slackConfigured ? (
              <HealthBadge health="healthy" label="Connected" />
            ) : (
              <span className="flex items-center gap-2">
                <HealthBadge health="unknown" label="Not set up" />
                <span className="text-xs text-slate-500">Set SLACK_WEBHOOK_URL (see README → Alerts).</span>
              </span>
            )}
          </Row>
          <Row label="What gets posted">
            <strong>Critical</strong> incidents when they open, escalate from Warning, or come back from a snooze; and
            their resolution.{" "}
            <span className="text-slate-500">
              Each incident alerts at most once. Warnings, maintenance, snoozed and ignored incidents stay on the
              dashboard.
            </span>
          </Row>
          <Row label="Links in alerts">
            {alertLinkBase ?? <span className="text-slate-500">No link (set APP_URL)</span>}
          </Row>
          <Row label="Weekly summary">
            {rules.summaryEnabled ? (
              <>
                {WEEKDAY_NAMES[rules.summaryWeekday - 1]}s at {rules.summaryHour}:00 ({APP_TIMEZONE})
              </>
            ) : (
              <>Off</>
            )}
            : open incidents, backups, PHP errors, certificates expiring within {SUMMARY_SSL_DAYS} days, WordPress
            updates, broken links and missing tags. Day and time: Monitoring rules above.{" "}
            <span className="text-slate-500">
              Last sent: {lastSummary ? <When iso={lastSummary} /> : "never"}
            </span>
            <div className="mt-2">
              <TestAlertButton
                kind="summary"
                disabledReason={
                  source === "sample" ? "Connect Supabase first" : !slackConfigured ? "Set SLACK_WEBHOOK_URL first" : undefined
                }
              />
            </div>
          </Row>
          <Row label="Test">
            <TestAlertButton
              disabledReason={
                source === "sample" ? "Connect Supabase first" : !slackConfigured ? "Set SLACK_WEBHOOK_URL first" : undefined
              }
            />
          </Row>
        </dl>
      </Panel>

      <Panel title="WP Engine" className="mt-6">
        <dl>
          <Row label="Connection">
            {wpe.ok ? (
              <HealthBadge health="healthy" label={wpe.message} />
            ) : wpe.message === "Not configured" ? (
              <span className="flex items-center gap-2">
                <HealthBadge health="unknown" label="Not set up" />
                <span className="text-xs text-slate-500">Set WPENGINE_API_USER and WPENGINE_API_PASSWORD (see README → WordPress health).</span>
              </span>
            ) : (
              <HealthBadge health="critical" label={wpe.message} />
            )}
          </Row>
          <Row label="What it adds">
            WordPress and PHP versions, install status and backups for sites hosted on WP Engine. A WordPress Health
            monitor is critical when there&apos;s no completed backup in {rules.backupMaxAgeHours} hours.
          </Row>
          {wpe.ok && (
            <Row label="Sites">
              <Link href="/wpengine" className="text-fig-plum hover:underline">
                Import sites from WP Engine
              </Link>
            </Row>
          )}
        </dl>
      </Panel>

      <Panel title="WordPress plugin" className="mt-6">
        <dl>
          <Row label="Signing key">
            {pluginKeySet ? (
              <HealthBadge health="healthy" label="Set" />
            ) : (
              <span className="flex items-center gap-2">
                <HealthBadge health="unknown" label="Not set up" />
                <span className="text-xs text-slate-500">
                  Set WEBSITE_WATCH_PLUGIN_KEY or WEBSITE_WATCH_PLUGIN_TOKEN (64 hex characters). See README → WordPress
                  plugin.
                </span>
              </span>
            )}
          </Row>
          <Row label="What it adds">
            A read-only plugin for each site. WordPress Health checks then see every plugin and theme with its
            available update (premium included), exact WordPress and PHP versions, debug mode and WP-Cron.
          </Row>
          {pluginKeySet && (
            <Row label="Download">
              <a href="/wordpress-plugin" className="text-fig-plum hover:underline">
                {WP_PLUGIN_ZIP}
              </a>{" "}
              <span className="text-xs text-slate-500">
                (version {WP_PLUGIN_VERSION}, with this key&apos;s public half built in. In WordPress: Plugins → Add New
                Plugin → Upload Plugin, then Activate.)
              </span>
            </Row>
          )}
        </dl>
      </Panel>

      <Panel title="Scheduled checks" className="mt-6">
        <dl>
          <Row label="Scheduler">
            Supabase <code>pg_cron</code>, every minute (or every 5 on older setups). It checks only monitors that are
            due.{" "}
            <span className="text-slate-500">Setup: README → Scheduled checks.</span>
          </Row>
          <Row label="CRON_SECRET">
            {cronSecretSet ? (
              <HealthBadge health="healthy" label="Set" />
            ) : (
              <span className="flex items-center gap-2">
                <HealthBadge health="unknown" label="Not set" />
                <span className="text-xs text-slate-500">The scheduler endpoint refuses all calls until it is.</span>
              </span>
            )}
          </Row>
          <Row label="Monitors due now">{dueNow}</Row>
          <Row label="Next scheduled check">
            <When iso={nextDue} empty="None scheduled" />
          </Row>
          <Row label="Most recent check">
            <When iso={lastCheck} />
          </Row>
          <Row label="Run now">
            <RunDueChecksButton
              disabledReason={source === "sample" ? "Connect Supabase to run checks" : undefined}
            />
          </Row>
        </dl>
      </Panel>
    </>
  );
}
