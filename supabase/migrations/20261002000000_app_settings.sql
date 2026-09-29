-- Website Watch: editable monitoring rules (Settings)

-- One row (id = 1). Defaults match the values the app used before this was
-- editable; the app also falls back to them if the row is missing.
create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  failures_to_open integer not null default 2 check (failures_to_open between 1 and 10),
  passes_to_resolve integer not null default 2 check (passes_to_resolve between 1 and 10),
  default_max_response_ms integer not null default 3000 check (default_max_response_ms between 500 and 30000),
  ssl_warning_days integer not null default 14 check (ssl_warning_days between 1 and 90),
  ssl_failure_days integer not null default 3 check (ssl_failure_days between 0 and 60),
  backup_max_age_hours integer not null default 48 check (backup_max_age_hours between 12 and 720),
  -- null: don't check the PHP version
  min_php_version text default '8.2' check (min_php_version is null or min_php_version ~ '^[5-9]\.[0-9]{1,2}$'),
  warn_on_updates boolean not null default true,
  summary_enabled boolean not null default true,
  -- 1 = Monday ... 7 = Sunday
  summary_weekday integer not null default 1 check (summary_weekday between 1 and 7),
  summary_hour integer not null default 9 check (summary_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (ssl_failure_days < ssl_warning_days)
);

insert into public.app_settings (id) values (1);

-- Server-side access only (secret key), like every other table.
alter table public.app_settings enable row level security;
