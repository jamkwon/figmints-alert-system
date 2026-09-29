-- Website Watch: Search Visibility and Domain Expiry monitors

alter table public.monitors drop constraint monitors_monitor_type_check;
alter table public.monitors add constraint monitors_monitor_type_check
  check (monitor_type in (
    'http_status', 'response_time', 'expected_content', 'ssl_expiry', 'broken_links', 'tracking_tags', 'wordpress_health',
    'search_visibility', 'domain_expiry'
  ));
