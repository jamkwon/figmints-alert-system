-- Website Watch: Weekly and Monthly check intervals

-- Supported check intervals: 5 min, 15 min, 30 min, 1 hour, 6 hours, daily,
-- weekly (7 days) and monthly (30 days).
alter table public.monitors drop constraint monitors_interval_supported;
alter table public.monitors
  add constraint monitors_interval_supported
  check (interval_minutes in (5, 15, 30, 60, 360, 1440, 10080, 43200));
