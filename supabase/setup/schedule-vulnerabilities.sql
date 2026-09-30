-- Website Watch: download the Wordfence vulnerability list once a day.
--
-- Run ONCE in the Supabase SQL Editor, after schedule-checks.sql (it reuses the
-- URL and secrets stored there) and the migration 20261010000000_vulnerabilities.sql,
-- with WORDFENCE_API_KEY set in Vercel (and redeployed).
-- Nothing to fill in: it has no secrets of its own.

-- Daily at 06:17 UTC. Wordfence limits how often a key can download, so keep
-- this to once a day.
select cron.schedule(
  'website-watch-refresh-vulnerabilities',
  '17 6 * * *',
  $$
  select net.http_post(
    url := replace(
      (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_cron_url'),
      '/api/cron/run-checks',
      '/api/cron/refresh-vulnerabilities'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_cron_secret'),
      'x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_bypass_secret')
    ),
    timeout_milliseconds := 300000
  );
  $$
);

-- Useful afterwards -----------------------------------------------------------
-- Last refresh (also shown in Settings → Vulnerabilities):
--   select refreshed_at, record_count, range_count, last_attempt_at, last_error from public.vulnerability_feed;
--
-- Remove the schedule:
--   select cron.unschedule('website-watch-refresh-vulnerabilities');
