-- Website Watch: schedule automatic checks with Supabase pg_cron.
--
-- Run ONCE in the Supabase SQL Editor, after:
--   1. the app is deployed on Vercel,
--   2. CRON_SECRET is set in Vercel (and redeployed),
--   3. all files in supabase/migrations/ have been run.
--
-- Replace the three placeholders below before running. The values are stored in
-- Supabase Vault (encrypted), not in the job definition.
-- This is not a migration: it contains your URL and secrets. Don't commit filled-in copies.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Your production URL + the scheduler path
select vault.create_secret(
  'https://YOUR-PRODUCTION-DOMAIN/api/cron/run-checks',
  'website_watch_cron_url'
);

-- 2. The same value as CRON_SECRET in Vercel
select vault.create_secret('PASTE_CRON_SECRET_HERE', 'website_watch_cron_secret');

-- 3. Vercel → Project → Settings → Deployment Protection →
--    Protection Bypass for Automation. Needed when Vercel Authentication protects
--    production ("All Deployments"). If you don't use protection, leave it as-is.
select vault.create_secret('PASTE_VERCEL_BYPASS_SECRET_HERE', 'website_watch_bypass_secret');

-- Every 5 minutes. The app decides which monitors are actually due.
select cron.schedule(
  'website-watch-run-checks',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_cron_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_cron_secret'),
      'x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets where name = 'website_watch_bypass_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Useful afterwards -----------------------------------------------------------
-- Recent scheduler runs (did pg_cron fire?):
--   select start_time, status, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'website-watch-run-checks')
--   order by start_time desc limit 10;
--
-- Recent HTTP responses from the app (status 200 = OK, 401 = wrong secret):
--   select created, status_code, left(content::text, 300) from net._http_response
--   order by created desc limit 10;
--
-- Change a stored value (e.g. after rotating CRON_SECRET):
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'website_watch_cron_secret'), 'NEW_VALUE');
--
-- Pause or remove the schedule:
--   select cron.unschedule('website-watch-run-checks');
