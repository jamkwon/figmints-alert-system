-- Website Watch: Phase 5 operational improvements

-- Timed snooze: a snoozed incident reopens when this passes (handled by the scheduler).
alter table public.incidents add column snoozed_until timestamptz;

-- Website maintenance window: while it's in the future, new incidents for this
-- website open as "expected_maintenance" instead of alerting.
alter table public.websites add column maintenance_until timestamptz;
alter table public.websites add column maintenance_note text not null default '';

-- Incident history -------------------------------------------------------------
-- Who changed what, when. actor is a staff email or 'system' (the incident engine).
create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  created_at timestamptz not null default now(),
  actor text not null default 'system',
  kind text not null
    check (kind in ('opened', 'status_changed', 'severity_changed', 'assigned', 'notes_updated', 'resolved', 'snooze_ended')),
  message text not null
);

create index incident_events_incident_idx on public.incident_events (incident_id, created_at desc);

alter table public.incident_events enable row level security;
grant select, insert, update, delete on public.incident_events to service_role;

-- Uptime -------------------------------------------------------------------------
-- Share of passing checks per monitor over 24 hours, 7 days and 30 days.
create view public.monitor_uptime with (security_invoker = true) as
select
  c.monitor_id,
  count(*) filter (where c.checked_at > now() - interval '24 hours') as checks_24h,
  count(*) filter (where c.checked_at > now() - interval '24 hours' and c.passed) as passed_24h,
  count(*) filter (where c.checked_at > now() - interval '7 days') as checks_7d,
  count(*) filter (where c.checked_at > now() - interval '7 days' and c.passed) as passed_7d,
  count(*) as checks_30d,
  count(*) filter (where c.passed) as passed_30d
from public.check_results c
where c.checked_at > now() - interval '30 days'
group by c.monitor_id;

grant select on public.monitor_uptime to service_role;

-- Check history retention: the scheduler deletes results older than 90 days once
-- an hour. This index keeps that delete from scanning the whole table.
create index check_results_checked_at_idx on public.check_results (checked_at);
