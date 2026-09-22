-- Website Watch: initial schema
-- Enumerated values use text + check constraints (easier to extend than Postgres enums).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Clients ---------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  primary_website text check (primary_website is null or primary_website ~* '^https?://'),
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- Websites --------------------------------------------------------------------

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  url text not null check (url ~* '^https?://'),
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index websites_client_id_idx on public.websites (client_id);

create trigger websites_set_updated_at before update on public.websites
  for each row execute function public.set_updated_at();

-- Monitors --------------------------------------------------------------------

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  monitor_type text not null default 'http_status'
    check (monitor_type in ('http_status', 'response_time', 'expected_content')),
  target_url text not null check (target_url ~* '^https?://'),
  -- null = default success range (HTTP 200-399)
  expected_status_code integer check (expected_status_code between 100 and 599),
  expected_text text,
  -- Only used by response_time monitors
  max_response_time_ms integer check (max_response_time_ms > 0),
  interval_minutes integer not null default 15 check (interval_minutes > 0),
  severity_on_failure text not null default 'critical'
    check (severity_on_failure in ('critical', 'warning', 'informational')),
  active boolean not null default true,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monitors_website_id_idx on public.monitors (website_id);
create index monitors_due_idx on public.monitors (next_check_at) where active;

create trigger monitors_set_updated_at before update on public.monitors
  for each row execute function public.set_updated_at();

-- Check results ---------------------------------------------------------------

create table public.check_results (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors (id) on delete cascade,
  status text not null check (status in ('passed', 'failed', 'warning')),
  checked_at timestamptz not null default now(),
  http_status integer,
  response_time_ms integer,
  passed boolean not null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

-- Supports "latest N checks for a monitor" (consecutive failure/success logic)
create index check_results_monitor_checked_idx on public.check_results (monitor_id, checked_at desc);
-- Supports "last successful check"
create index check_results_monitor_passed_idx on public.check_results (monitor_id, checked_at desc) where passed;

-- Incidents -------------------------------------------------------------------

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  website_id uuid references public.websites (id) on delete set null,
  monitor_id uuid references public.monitors (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  severity text not null default 'warning'
    check (severity in ('critical', 'warning', 'informational')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'snoozed', 'resolved', 'expected_maintenance', 'ignored')),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  assigned_team text not null default 'unassigned'
    check (assigned_team in ('development', 'account_management', 'seo', 'ads', 'client', 'unassigned')),
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index incidents_client_id_idx on public.incidents (client_id);
create index incidents_monitor_id_idx on public.incidents (monitor_id);
create index incidents_status_idx on public.incidents (status);

create trigger incidents_set_updated_at before update on public.incidents
  for each row execute function public.set_updated_at();

-- Monitor status summary ------------------------------------------------------
-- Latest check + last known good per monitor. security_invoker keeps RLS in force.

create view public.monitor_check_summary with (security_invoker = true) as
select
  m.id as monitor_id,
  latest.status as last_status,
  latest.checked_at as last_result_at,
  latest.http_status as last_http_status,
  latest.response_time_ms as last_response_time_ms,
  latest.error_message as last_error_message,
  (
    select max(c.checked_at)
    from public.check_results c
    where c.monitor_id = m.id and c.passed
  ) as last_success_at
from public.monitors m
left join lateral (
  select c.status, c.checked_at, c.http_status, c.response_time_ms, c.error_message
  from public.check_results c
  where c.monitor_id = m.id
  order by c.checked_at desc
  limit 1
) latest on true;

-- Access ----------------------------------------------------------------------
-- Internal tool: the app talks to Supabase only from the server using the secret
-- (service role) key, which bypasses RLS. RLS is enabled with no policies so the
-- public anon/publishable key cannot read or write anything.

alter table public.clients enable row level security;
alter table public.websites enable row level security;
alter table public.monitors enable row level security;
alter table public.check_results enable row level security;
alter table public.incidents enable row level security;

grant select, insert, update, delete on
  public.clients, public.websites, public.monitors, public.check_results, public.incidents
  to service_role;
grant select on public.monitor_check_summary to service_role;
