-- Website Watch: faster uptime numbers
--
-- Every page load reads monitor_uptime, which counted all checks from the last
-- 30 days by reading each row from the table. This index also carries "passed",
-- so the counts (and daily_uptime) are answered from the index alone. It replaces
-- the index with the same key, so check inserts don't maintain both.

create index if not exists check_results_monitor_checked_passed_idx
  on public.check_results (monitor_id, checked_at desc) include (passed);
drop index if exists public.check_results_monitor_checked_idx;

-- Same columns as before; now counted per monitor, one index range each.
create or replace view public.monitor_uptime with (security_invoker = true) as
select
  m.id as monitor_id,
  u.checks_24h,
  u.passed_24h,
  u.checks_7d,
  u.passed_7d,
  u.checks_30d,
  u.passed_30d
from public.monitors m
cross join lateral (
  select
    count(*) filter (where c.checked_at > now() - interval '24 hours') as checks_24h,
    count(*) filter (where c.checked_at > now() - interval '24 hours' and c.passed) as passed_24h,
    count(*) filter (where c.checked_at > now() - interval '7 days') as checks_7d,
    count(*) filter (where c.checked_at > now() - interval '7 days' and c.passed) as passed_7d,
    count(*) as checks_30d,
    count(*) filter (where c.passed) as passed_30d
  from public.check_results c
  where c.monitor_id = m.id
    and c.checked_at > now() - interval '30 days'
) u
where u.checks_30d > 0;

grant select on public.monitor_uptime to service_role;
