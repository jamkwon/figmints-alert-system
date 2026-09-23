-- Website Watch: Phase 4 scheduled monitoring

-- Supported check intervals: 5 min, 15 min, 30 min, 1 hour, 6 hours, daily.
-- The scheduler runs every 5 minutes, so shorter intervals wouldn't be honored.
alter table public.monitors
  add constraint monitors_interval_supported
  check (interval_minutes in (5, 15, 30, 60, 360, 1440));

-- Claims up to max_count monitors that are due and returns them.
--
-- "Due" = active monitor on an active website and client, whose next_check_at is
-- empty or within grace_seconds from now. The grace window keeps a 5-minute monitor
-- from slipping to 10 minutes when the scheduler fires a few seconds early.
--
-- Claiming moves next_check_at forward by lease_minutes, so an overlapping run
-- (or a duplicate cron delivery) can't pick the same monitor. Recording the check
-- then sets the real next_check_at. If a run dies mid-way, the lease expires and
-- the monitor is picked up again. SKIP LOCKED lets concurrent runs share the work.
create or replace function public.claim_due_monitors(
  max_count integer default 20,
  grace_seconds integer default 60,
  lease_minutes integer default 5
)
returns setof public.monitors
language sql
set search_path = ''
as $$
  update public.monitors m
  set next_check_at = now() + make_interval(mins => lease_minutes)
  where m.id in (
    select due.id
    from public.monitors due
    join public.websites w on w.id = due.website_id
    join public.clients c on c.id = w.client_id
    where due.active
      and w.active
      and c.active
      and (due.next_check_at is null or due.next_check_at <= now() + make_interval(secs => grace_seconds))
    order by due.next_check_at asc nulls first
    limit max_count
    for update of due skip locked
  )
  returning m.*;
$$;

-- Only the server (secret key) may call it; Supabase exposes functions over the
-- API by default, so remove access for the public roles.
revoke execute on function public.claim_due_monitors(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_due_monitors(integer, integer, integer) to service_role;
