-- Website Watch: Page Speed monitors (Google PageSpeed Insights)

alter table public.monitors drop constraint monitors_monitor_type_check;
alter table public.monitors add constraint monitors_monitor_type_check
  check (monitor_type in (
    'http_status', 'response_time', 'expected_content', 'ssl_expiry', 'broken_links', 'tracking_tags', 'wordpress_health',
    'search_visibility', 'domain_expiry', 'page_speed'
  ));

-- Settings: Warning below this Lighthouse performance score (0 turns it off).
alter table public.app_settings
  add column min_performance_score integer not null default 50 check (min_performance_score between 0 and 100);
