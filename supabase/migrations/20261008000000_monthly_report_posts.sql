-- Website Watch: post last month's client reports to Slack on the 1st

-- One row per month whose reports were posted. The scheduler inserts the row
-- before posting, so overlapping runs can't both post; a failed post deletes it
-- so the next run retries.
create table public.monthly_report_posts (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sent_at timestamptz not null default now()
);

-- Server-side access only (secret key), like every other table.
alter table public.monthly_report_posts enable row level security;

-- Settings: turn the monthly posting on or off.
alter table public.app_settings add column monthly_reports_enabled boolean not null default true;
