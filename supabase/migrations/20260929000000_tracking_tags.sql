-- Website Watch: Phase 8, tracking tag monitors

alter table public.monitors drop constraint monitors_monitor_type_check;
alter table public.monitors add constraint monitors_monitor_type_check
  check (monitor_type in ('http_status', 'response_time', 'expected_content', 'ssl_expiry', 'broken_links', 'tracking_tags'));

-- Tags a tracking_tags monitor expects on its page. Empty for other monitor types.
alter table public.monitors add column expected_tags text[] not null default '{}'
  check (expected_tags <@ array['gtm', 'ga4', 'google_ads', 'meta_pixel', 'linkedin', 'hubspot']::text[]);
