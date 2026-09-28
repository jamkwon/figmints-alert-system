-- Website Watch: Phase 9, weekly Slack summary

-- One row per week that got its summary. The scheduler inserts the row before
-- posting, so overlapping runs can't both send it; a failed post deletes the
-- row so the next run retries.
create table public.weekly_summaries (
  week_start date primary key,
  sent_at timestamptz not null default now()
);

-- Server-side access only (secret key), like every other table.
alter table public.weekly_summaries enable row level security;
