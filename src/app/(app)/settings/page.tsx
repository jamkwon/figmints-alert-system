import type { Metadata } from "next";
import { connection } from "next/server";
import { Fragment, type ReactNode } from "react";
import { RunDueChecksButton } from "@/components/run-due-checks-button";
import { TestAlertButton } from "@/components/test-alert-button";
import { HealthBadge } from "@/components/status";
import { Panel, PageHeader, When } from "@/components/ui";
import { getDataSource, getSchedulerStatus } from "@/lib/data";
import { APP_TIMEZONE } from "@/lib/format";
import { allowedDomains } from "@/lib/auth/session";
import { SSL_FAILURE_DAYS, SSL_WARNING_DAYS } from "@/lib/monitoring/evaluate";
import { MAX_LINKS } from "@/lib/monitoring/links";
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

export default async function SettingsPage() {
  await connection();
  const source = getDataSource();
  const env = supabaseEnvStatus();
  const cronSecretSet = (process.env.CRON_SECRET?.length ?? 0) >= 16;

  const { dueNow, nextDue, lastCheck } = await getSchedulerStatus();
  const slackConfigured = slackWebhookUrl() !== null;
  const alertLinkBase = appUrl();

  return (
    <>
      <PageHeader title="Settings" description="Read-only for now. Editable settings come in a later phase." />

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

      <Panel title="Monitoring rules">
        <dl>
          <Row label="Open an incident after">
            2 consecutive failed or slow checks{" "}
            <span className="text-slate-500">(severity from the monitor; slow responses are at most Warning)</span>
          </Row>
          <Row label="Resolve an incident after">2 consecutive successful checks</Row>
          <Row label="Default HTTP success">Status 200–399 (unless a monitor sets an expected status)</Row>
          <Row label="Display timezone">{APP_TIMEZONE}</Row>
          <Row label="Check intervals">5 min, 15 min, 30 min, 1 hour, 6 hours, daily</Row>
          <Row label="SSL certificates">
            Warning at {SSL_WARNING_DAYS} days left; failed at {SSL_FAILURE_DAYS} days, or when expired, untrusted or for
            the wrong domain
          </Row>
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
          <Row label="Test">
            <TestAlertButton
              disabledReason={
                source === "sample" ? "Connect Supabase first" : !slackConfigured ? "Set SLACK_WEBHOOK_URL first" : undefined
              }
            />
          </Row>
        </dl>
      </Panel>

      <Panel title="Scheduled checks" className="mt-6">
        <dl>
          <Row label="Scheduler">
            Every 5 minutes via Supabase <code>pg_cron</code>. It checks only monitors that are due.{" "}
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
