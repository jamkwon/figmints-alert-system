-- Website Watch: known vulnerabilities (Wordfence Intelligence feed)

alter table public.monitors drop constraint monitors_monitor_type_check;
alter table public.monitors add constraint monitors_monitor_type_check
  check (monitor_type in (
    'http_status', 'response_time', 'expected_content', 'ssl_expiry', 'broken_links', 'tracking_tags', 'wordpress_health',
    'search_visibility', 'domain_expiry', 'page_speed', 'contact_form', 'vulnerabilities'
  ));

-- One row per affected version range, downloaded once a day. A refresh writes a
-- new generation, then switches vulnerability_feed.generation to it and deletes
-- the old one, so checks never see a half-loaded list.
create table public.wp_vulnerabilities (
  id bigint generated always as identity primary key,
  generation integer not null,
  vuln_id text not null,
  software_type text not null check (software_type in ('core', 'plugin', 'theme')),
  slug text not null,
  -- null: no bound ("*")
  from_version text,
  from_inclusive boolean not null default true,
  to_version text,
  to_inclusive boolean not null default true,
  patched_versions text[] not null default '{}',
  title text not null,
  cvss_score numeric(3, 1) check (cvss_score between 0 and 10),
  cvss_vector text,
  cvss_rating text,
  url text not null,
  published_at timestamptz
);

create index wp_vulnerabilities_lookup_idx on public.wp_vulnerabilities (generation, software_type, slug);

alter table public.wp_vulnerabilities enable row level security;

-- One row (id = 1): which generation is current and how the last refresh went.
create table public.vulnerability_feed (
  id integer primary key default 1 check (id = 1),
  -- 0: never loaded
  generation integer not null default 0,
  refreshed_at timestamptz,
  record_count integer not null default 0,
  range_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text
);

insert into public.vulnerability_feed (id) values (1);

alter table public.vulnerability_feed enable row level security;

-- Settings: a vulnerability that needs no login fails the check (Critical, so
-- Slack hears about it) from this CVSS score up. Everything else is a Warning.
alter table public.app_settings
  add column vuln_min_cvss integer not null default 7 check (vuln_min_cvss between 0 and 10);

-- Every website with a WordPress Health monitor gets a Vulnerabilities monitor.
-- It first runs a day from now; the first feed download makes them all due sooner.
insert into public.monitors (website_id, name, monitor_type, target_url, interval_minutes, severity_on_failure, active, next_check_at)
select distinct on (m.website_id)
  m.website_id, 'Vulnerabilities', 'vulnerabilities', m.target_url, 1440, 'critical', m.active, now() + interval '1 day'
from public.monitors m
where m.monitor_type = 'wordpress_health'
  and not exists (
    select 1 from public.monitors v where v.website_id = m.website_id and v.monitor_type = 'vulnerabilities'
  )
order by m.website_id, m.created_at;
