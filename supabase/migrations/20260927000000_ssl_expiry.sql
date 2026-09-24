-- Website Watch: Phase 8, SSL certificate expiry monitors

alter table public.monitors drop constraint monitors_monitor_type_check;
alter table public.monitors add constraint monitors_monitor_type_check
  check (monitor_type in ('http_status', 'response_time', 'expected_content', 'ssl_expiry'));

-- Expose the latest check's metadata (for SSL: expiry date, days left, issuer).
-- Same columns as before, with last_metadata appended.
create or replace view public.monitor_check_summary with (security_invoker = true) as
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
  ) as last_success_at,
  latest.metadata as last_metadata
from public.monitors m
left join lateral (
  select c.status, c.checked_at, c.http_status, c.response_time_ms, c.error_message, c.metadata
  from public.check_results c
  where c.monitor_id = m.id
  order by c.checked_at desc
  limit 1
) latest on true;
