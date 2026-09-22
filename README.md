# Website Watch

**Figmints Website Health Monitor.** An internal tool for catching problems on client websites before the client notices them.

This app is for the Figmints team only. It has no client accounts, public pages, or billing.

## Status

**Phase 1 (foundation): done.** Includes the app shell, database schema, sample data, and the Dashboard, Clients, Client detail, Incidents, Checks, and Settings screens.

Phase 1 does **not** check any websites yet. Every status you see comes from seeded or sample data. Real HTTP checks arrive in Phase 2, the incident engine in Phase 3, and scheduling in Phase 4.

## Stack

- Next.js 16 (App Router, TypeScript, Turbopack)
- Tailwind CSS 4
- Supabase (Postgres), accessed **server-side only**
- Vercel, for eventual deployment

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

If Supabase isn't configured, the app runs on **built-in sample data** (`src/lib/sample-data.ts`) and shows a yellow banner at the top of every page. You can explore the UI without setting up a database.

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | For real data | Supabase project URL |
| `SUPABASE_SECRET_KEY` | For real data | Supabase secret key (`sb_secret_...`) or legacy `service_role` key. **Server-only.** |
| `APP_TIMEZONE` | No | Timezone for displayed times. Default `America/New_York`. |

Both Supabase variables must be set for the app to use Supabase. Settings shows which data source is active.

> Never prefix these with `NEXT_PUBLIC_`. The secret key bypasses row-level security and must never reach the browser. The Supabase client lives in `src/lib/supabase/server.ts`, which imports `server-only`, so the build fails if that file is ever imported into client code.

## Database setup

The schema lives in `supabase/migrations/`. Sample data lives in `supabase/seed.sql`.

### Option A: Supabase dashboard (simplest)

1. Create a Supabase project.
2. Open **SQL Editor** and run the contents of `supabase/migrations/20260922000000_initial_schema.sql`.
3. (Optional) Run `supabase/seed.sql` to load the 6 sample clients. You can re-run it safely; it replaces the earlier sample rows.
4. Copy the project URL and the secret key into `.env.local`, then restart `npm run dev`.

### Option B: Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies supabase/migrations
# Load sample data by running supabase/seed.sql in the SQL Editor,
# or with psql against the project connection string.
```

For a local Supabase stack (requires Docker), run `npx supabase init` once, then `npx supabase start`. `npx supabase db reset` applies the migrations and the seed file.

### Schema overview

| Table | Purpose |
| --- | --- |
| `clients` | Figmints clients (name, primary website, active, notes) |
| `websites` | One or more sites or environments per client (production / staging / development) |
| `monitors` | What to check: type, target URL, expected status/text, interval, severity on failure |
| `check_results` | One row per monitor run (status, HTTP code, response time, error, metadata) |
| `incidents` | Meaningful problems: severity, status, team, timeline, internal notes |
| `monitor_check_summary` (view) | Latest check and last successful check per monitor ("last known good") |

Row-level security is enabled on every table with **no policies**. The public anon/publishable key can read nothing; only the server's secret key has access.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit tests for health rules (Node's built-in test runner) |

## Project layout

```
src/
  app/                  Routes: dashboard, clients, clients/[id], incidents, checks, settings
  components/           Sidebar, status badges, shared tables, UI primitives
  lib/
    data.ts             Loads data (Supabase or sample) and builds view models
    health.ts           Health rules: monitor → website → client roll-up
    sample-data.ts      Built-in sample data (mirrors supabase/seed.sql)
    supabase/server.ts  Server-only Supabase client
    types.ts            Row types matching the SQL schema
supabase/
  migrations/           SQL schema
  seed.sql              Sample data
```

## How health is determined

- **Monitor:** an open or investigating incident sets the monitor to that incident's severity. A snoozed or expected-maintenance incident makes it *informational*. With no incident, the latest check decides: passed → healthy, failed or slow → warning, no checks yet → no data.
- **Website / client:** the worst status among active monitors and active incidents. Anything inactive shows as inactive.
- Order: Critical > Warning > Informational > No data > Healthy.

## Security notes

- This is an internal tool, but **it has no login yet**. Before deploying anywhere reachable, put it behind Vercel Deployment Protection (or add authentication in a later phase).
- All database access runs server-side.
- Phase 2 must add SSRF protection before fetching any monitor URL. That means allowing only http/https and blocking private, loopback, and link-local addresses.
