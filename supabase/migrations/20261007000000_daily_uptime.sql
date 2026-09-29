-- Website Watch: uptime history (per-day totals for the 90-day bars)

-- Checks and passes per monitor per local day, counted in the database so the
-- app doesn't load every check (a 5-minute monitor makes ~26,000 in 90 days).
-- Uses the (monitor_id, checked_at) index.
create or replace function public.daily_uptime(monitor_ids uuid[], since timestamptz, tz text)
returns table (monitor_id uuid, day date, checks bigint, passed bigint)
language sql
stable
set search_path = public
as $$
  select c.monitor_id,
         (c.checked_at at time zone tz)::date as day,
         count(*) as checks,
         count(*) filter (where c.passed) as passed
  from public.check_results c
  where c.monitor_id = any(monitor_ids)
    and c.checked_at >= since
  group by c.monitor_id, (c.checked_at at time zone tz)::date
$$;

-- Server-side only (secret key), like every other table and function.
revoke execute on function public.daily_uptime(uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function public.daily_uptime(uuid[], timestamptz, text) to service_role;
