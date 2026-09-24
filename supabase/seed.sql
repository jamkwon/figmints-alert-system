-- Website Watch: SAMPLE data for local development and demos.
-- All clients are fictional and use the reserved .example domain.
-- Mirrors src/lib/sample-data.ts (used when Supabase is not configured).
-- Safe to re-run: removes previously seeded sample rows first.

delete from public.clients where id in (
  '11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000002',
  '11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000004',
  '11111111-1111-4111-8111-000000000005', '11111111-1111-4111-8111-000000000006'
);

insert into public.clients (id, name, primary_website, active, notes) values
  ('11111111-1111-4111-8111-000000000001', 'Harborview Dental (Sample)', 'https://harborviewdental.example', true,
   'Lead generation site. Appointment requests come through the Contact page.'),
  ('11111111-1111-4111-8111-000000000002', 'Northgate Title Co. (Sample)', 'https://northgatetitle.example', true,
   'Hosting plan is on the small side; watch response times during business hours.'),
  ('11111111-1111-4111-8111-000000000003', 'Blue Finch Bakery (Sample)', 'https://bluefinchbakery.example', true,
   'Ecommerce: online orders for pickup. Shop page is business-critical.'),
  ('11111111-1111-4111-8111-000000000004', 'Summit Ridge Academy (Sample)', 'https://summitridgeacademy.example', true,
   'Admissions season runs October through January.'),
  ('11111111-1111-4111-8111-000000000005', 'Coastal Roofing Pros (Sample)', 'https://coastalroofingpros.example', true,
   'Free estimate form is the main lead source.'),
  ('11111111-1111-4111-8111-000000000006', 'Maple & Oak Law (Sample)', 'https://mapleoaklaw.example', false,
   'Contract paused. Monitoring disabled.');

insert into public.websites (id, client_id, name, url, environment, active) values
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-000000000001', 'Main site', 'https://harborviewdental.example', 'production', true),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-000000000002', 'Main site', 'https://northgatetitle.example', 'production', true),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-000000000003', 'Main site', 'https://bluefinchbakery.example', 'production', true),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-000000000004', 'Main site', 'https://summitridgeacademy.example', 'production', true),
  ('22222222-2222-4222-8222-000000000005', '11111111-1111-4111-8111-000000000004', 'Staging', 'https://staging.summitridgeacademy.example', 'staging', true),
  ('22222222-2222-4222-8222-000000000006', '11111111-1111-4111-8111-000000000005', 'Main site', 'https://coastalroofingpros.example', 'production', true),
  ('22222222-2222-4222-8222-000000000007', '11111111-1111-4111-8111-000000000006', 'Main site', 'https://mapleoaklaw.example', 'production', true);

-- last_min = minutes since the monitor last ran
insert into public.monitors (
  id, website_id, name, monitor_type, target_url, expected_text, max_response_time_ms,
  interval_minutes, severity_on_failure, active, last_checked_at, next_check_at
)
select v.id::uuid, v.website_id::uuid, v.name, v.monitor_type, v.target_url, v.expected_text, v.max_ms,
  v.interval_minutes, v.severity, v.active,
  now() - make_interval(mins => v.last_min),
  now() - make_interval(mins => v.last_min) + make_interval(mins => v.interval_minutes)
from (values
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'Homepage', 'http_status', 'https://harborviewdental.example/', null, null, 5, 'critical', true, 1),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000001', 'Contact Page', 'expected_content', 'https://harborviewdental.example/contact', 'Request an Appointment', null, 5, 'critical', true, 3),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000001', 'Services Page', 'http_status', 'https://harborviewdental.example/services', null, null, 15, 'warning', true, 6),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000002', 'Homepage Response Time', 'response_time', 'https://northgatetitle.example/', null, 2000, 15, 'warning', true, 4),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000002', 'Contact Page', 'http_status', 'https://northgatetitle.example/contact', null, null, 15, 'critical', true, 9),
  ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-000000000003', 'Homepage', 'http_status', 'https://bluefinchbakery.example/', null, null, 5, 'critical', true, 2),
  ('33333333-3333-4333-8333-000000000007', '22222222-2222-4222-8222-000000000003', 'Shop Page', 'expected_content', 'https://bluefinchbakery.example/shop', 'Add to cart', null, 15, 'critical', true, 11),
  ('33333333-3333-4333-8333-000000000008', '22222222-2222-4222-8222-000000000004', 'Homepage', 'http_status', 'https://summitridgeacademy.example/', null, null, 15, 'critical', true, 5),
  ('33333333-3333-4333-8333-000000000009', '22222222-2222-4222-8222-000000000004', 'Admissions Page', 'expected_content', 'https://summitridgeacademy.example/admissions', 'Schedule a Visit', null, 60, 'critical', true, 23),
  ('33333333-3333-4333-8333-000000000010', '22222222-2222-4222-8222-000000000005', 'Staging Homepage', 'http_status', 'https://staging.summitridgeacademy.example/', null, null, 60, 'informational', true, 14),
  ('33333333-3333-4333-8333-000000000011', '22222222-2222-4222-8222-000000000006', 'Homepage', 'http_status', 'https://coastalroofingpros.example/', null, null, 5, 'critical', true, 3),
  ('33333333-3333-4333-8333-000000000012', '22222222-2222-4222-8222-000000000006', 'Free Estimate Page', 'expected_content', 'https://coastalroofingpros.example/free-estimate', 'Get Your Free Estimate', null, 15, 'warning', true, 8),
  ('33333333-3333-4333-8333-000000000013', '22222222-2222-4222-8222-000000000007', 'Homepage', 'http_status', 'https://mapleoaklaw.example/', null, null, 60, 'critical', false, 17280)
) as v(id, website_id, name, monitor_type, target_url, expected_text, max_ms, interval_minutes, severity, active, last_min);

-- Passing history: 12 checks per monitor, newest at `latest_min` minutes ago
insert into public.check_results (monitor_id, status, checked_at, http_status, response_time_ms, passed)
select m.id, 'passed', now() - make_interval(mins => v.latest_min + g * m.interval_minutes), 200,
  case when m.monitor_type = 'response_time' then 1100 + (g * 53) % 300 else 280 + (g * 37) % 400 end,
  true
from (values
  ('33333333-3333-4333-8333-000000000001'::uuid, 1),
  ('33333333-3333-4333-8333-000000000002'::uuid, 18),
  ('33333333-3333-4333-8333-000000000003'::uuid, 6),
  ('33333333-3333-4333-8333-000000000004'::uuid, 64),
  ('33333333-3333-4333-8333-000000000005'::uuid, 9),
  ('33333333-3333-4333-8333-000000000006'::uuid, 2),
  ('33333333-3333-4333-8333-000000000007'::uuid, 11),
  ('33333333-3333-4333-8333-000000000008'::uuid, 5),
  ('33333333-3333-4333-8333-000000000009'::uuid, 23),
  ('33333333-3333-4333-8333-000000000010'::uuid, 2880),
  ('33333333-3333-4333-8333-000000000011'::uuid, 3),
  ('33333333-3333-4333-8333-000000000012'::uuid, 68),
  ('33333333-3333-4333-8333-000000000013'::uuid, 17280)
) as v(monitor_id, latest_min)
join public.monitors m on m.id = v.monitor_id
cross join generate_series(0, 11) as g;

-- Recent failures
insert into public.check_results (monitor_id, status, checked_at, http_status, response_time_ms, passed, error_message)
select v.monitor_id::uuid, v.status, now() - make_interval(mins => v.min_ago), v.http_status, v.response_ms, false, v.error_message
from (values
  -- Harborview Dental: contact page 500
  ('33333333-3333-4333-8333-000000000002', 'failed', 13, 500, 612, 'HTTP 500 Internal Server Error'),
  ('33333333-3333-4333-8333-000000000002', 'failed', 8, 500, 587, 'HTTP 500 Internal Server Error'),
  ('33333333-3333-4333-8333-000000000002', 'failed', 3, 500, 640, 'HTTP 500 Internal Server Error'),
  -- Northgate Title: slow homepage
  ('33333333-3333-4333-8333-000000000004', 'warning', 49, 200, 3600, 'Response time 3600 ms exceeds 2000 ms threshold'),
  ('33333333-3333-4333-8333-000000000004', 'warning', 34, 200, 4100, 'Response time 4100 ms exceeds 2000 ms threshold'),
  ('33333333-3333-4333-8333-000000000004', 'warning', 19, 200, 3900, 'Response time 3900 ms exceeds 2000 ms threshold'),
  ('33333333-3333-4333-8333-000000000004', 'warning', 4, 200, 4400, 'Response time 4400 ms exceeds 2000 ms threshold'),
  -- Summit Ridge staging: planned rebuild
  ('33333333-3333-4333-8333-000000000010', 'failed', 14, 503, 95, 'HTTP 503 Service Unavailable'),
  -- Coastal Roofing: expected text missing
  ('33333333-3333-4333-8333-000000000012', 'failed', 53, 200, 820, 'Expected text "Get Your Free Estimate" not found'),
  ('33333333-3333-4333-8333-000000000012', 'failed', 38, 200, 790, 'Expected text "Get Your Free Estimate" not found'),
  ('33333333-3333-4333-8333-000000000012', 'failed', 23, 200, 845, 'Expected text "Get Your Free Estimate" not found'),
  ('33333333-3333-4333-8333-000000000012', 'failed', 8, 200, 801, 'Expected text "Get Your Free Estimate" not found')
) as v(monitor_id, status, min_ago, http_status, response_ms, error_message);

insert into public.incidents (
  id, client_id, website_id, monitor_id, title, description, severity, status,
  first_detected_at, last_detected_at, resolved_at, assigned_team, internal_notes
)
select v.id::uuid, v.client_id::uuid, v.website_id::uuid, v.monitor_id::uuid, v.title, v.description, v.severity, v.status,
  now() - make_interval(mins => v.first_min),
  now() - make_interval(mins => v.last_min),
  case when v.resolved_min is null then null else now() - make_interval(mins => v.resolved_min) end,
  v.team, v.notes
from (values
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000002',
   'Contact page is unavailable', 'Failed 3 consecutive checks. /contact is returning HTTP 500 Internal Server Error.',
   'critical', 'open', 13, 3, null::int, 'development', ''),
  ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000004',
   'Homepage response time significantly above normal', 'Last 4 checks averaged 4.0 s against a 2.0 s threshold. Normal is about 1.2 s.',
   'warning', 'open', 49, 4, null::int, 'unassigned', ''),
  ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-000000000005', '22222222-2222-4222-8222-000000000006', '33333333-3333-4333-8333-000000000012',
   'Expected content missing on Free Estimate page', 'Page returns HTTP 200 but "Get Your Free Estimate" was not found. Failed 4 consecutive checks.',
   'warning', 'investigating', 53, 8, null::int, 'development',
   'Theme update deployed this morning. Checking whether the heading changed or the form block is missing.'),
  ('44444444-4444-4444-8444-000000000004', '11111111-1111-4111-8111-000000000004', '22222222-2222-4222-8222-000000000005', '33333333-3333-4333-8333-000000000010',
   'Staging site offline for planned rebuild', 'Staging returns HTTP 503 during the scheduled rebuild.',
   'informational', 'expected_maintenance', 2820, 14, null::int, 'development', 'Rebuild expected to finish Friday.'),
  ('44444444-4444-4444-8444-000000000005', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000003', '33333333-3333-4333-8333-000000000007',
   'Shop page returned 502 Bad Gateway', 'Failed 3 consecutive checks. /shop returned HTTP 502.',
   'critical', 'resolved', 4380, 4350, 4320, 'development', 'Host restarted PHP workers; shop recovered.'),
  ('44444444-4444-4444-8444-000000000006', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000002', '33333333-3333-4333-8333-000000000005',
   'Contact page returned 404 after menu update', 'Failed 2 consecutive checks. /contact returned HTTP 404.',
   'critical', 'resolved', 8640, 8625, 8595, 'account_management', 'Page slug changed during a content update. Redirect added.')
) as v(id, client_id, website_id, monitor_id, title, description, severity, status, first_min, last_min, resolved_min, team, notes);

-- Staging is mid-rebuild: in a maintenance window for the next 2 days (Phase 5).
update public.websites
set maintenance_until = now() + interval '2 days', maintenance_note = 'Planned rebuild'
where id = '22222222-2222-4222-8222-000000000005';

-- SSL certificate monitors (Phase 8): Blue Finch is fine (83 days left),
-- Coastal Roofing expires in 12 days (warning).
insert into public.monitors (id, website_id, name, monitor_type, target_url, interval_minutes, severity_on_failure, last_checked_at, next_check_at)
values
  ('33333333-3333-4333-8333-000000000014', '22222222-2222-4222-8222-000000000003', 'SSL Certificate', 'ssl_expiry',
   'https://bluefinchbakery.example/', 360, 'critical', now() - interval '45 minutes', now() + interval '315 minutes'),
  ('33333333-3333-4333-8333-000000000015', '22222222-2222-4222-8222-000000000006', 'SSL Certificate', 'ssl_expiry',
   'https://coastalroofingpros.example/', 360, 'critical', now() - interval '40 minutes', now() + interval '320 minutes');

insert into public.check_results (monitor_id, status, checked_at, response_time_ms, passed, error_message, metadata)
select v.monitor_id::uuid, v.status, now() - make_interval(mins => v.min_ago), 140, v.passed, v.error_message,
  jsonb_build_object(
    'valid_to', now() + make_interval(days => v.days_from_now),
    'days_left', v.days_from_now + floor(v.min_ago / 1440.0)::int,
    'issuer', 'Let''s Encrypt'
  )
from (values
  ('33333333-3333-4333-8333-000000000014', 'passed', 45, true, null, 83),
  ('33333333-3333-4333-8333-000000000014', 'passed', 405, true, null, 83),
  ('33333333-3333-4333-8333-000000000015', 'warning', 40, false, 'SSL certificate expires in 12 days', 12),
  ('33333333-3333-4333-8333-000000000015', 'passed', 400, true, null, 12)
) as v(monitor_id, status, min_ago, passed, error_message, days_from_now);

-- Broken link scan (Phase 8): Summit Ridge's homepage has 2 broken links.
insert into public.monitors (id, website_id, name, monitor_type, target_url, interval_minutes, severity_on_failure, last_checked_at, next_check_at)
values ('33333333-3333-4333-8333-000000000016', '22222222-2222-4222-8222-000000000004', 'Broken Links (Homepage)', 'broken_links',
        'https://summitridgeacademy.example/', 1440, 'warning', now() - interval '60 minutes', now() + interval '1380 minutes');

insert into public.check_results (monitor_id, status, checked_at, http_status, response_time_ms, passed, error_message, metadata)
values
  ('33333333-3333-4333-8333-000000000016', 'passed', now() - interval '1500 minutes', 200, 13800, true, null,
   '{"links_found": 58, "links_checked": 40, "links_unverified": 1, "broken_links": []}'),
  ('33333333-3333-4333-8333-000000000016', 'warning', now() - interval '60 minutes', 200, 14200, false,
   '2 broken links of 40 checked: /tuition-2024 (HTTP 404), /img/campus-map.pdf (HTTP 404)',
   '{"links_found": 58, "links_checked": 40, "links_unverified": 1, "broken_links": [
      {"url": "https://summitridgeacademy.example/tuition-2024", "kind": "link", "text": "2024 Tuition", "reason": "HTTP 404"},
      {"url": "https://summitridgeacademy.example/img/campus-map.pdf", "kind": "link", "text": "Campus map", "reason": "HTTP 404"}]}');
