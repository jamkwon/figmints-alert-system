-- Website Watch: client links (a client's live report, no login)

-- A link opens one client's report after its password. The token is kept as-is
-- (not hashed) so staff can copy the link again later; anyone who can read this
-- table can already read the report data. The password is only kept hashed
-- (scrypt), so staff see it once and make a new one if it's lost.
-- Revoking sets revoked_at; at most one link per client works at a time.
create table public.client_share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  -- 32 random bytes, base64url
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  password_hash text not null,
  -- Wrong passwords in a row; enough of them locks the link for a while.
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz
);

create unique index client_share_links_one_active_idx on public.client_share_links (client_id) where revoked_at is null;

-- Server-side access only (secret key), like every other table.
alter table public.client_share_links enable row level security;
