-- Website Watch: Phase 3 incident engine
-- A monitor can have at most one unresolved incident. Guards against two checks
-- finishing at the same time and both opening an incident.
-- "Unresolved" = not yet resolved, in any status (open, investigating, snoozed,
-- expected maintenance, ignored).

create unique index if not exists incidents_one_unresolved_per_monitor
  on public.incidents (monitor_id)
  where resolved_at is null and status <> 'resolved' and monitor_id is not null;
