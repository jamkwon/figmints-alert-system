# Website Watch

**Figmints Website Health Monitor.** An internal tool for catching problems on client websites before the client notices them.

This app is for the Figmints team only. It has no client accounts, public pages, or billing.

## Status

- **Phase 1 (foundation): done.** App shell, database schema, sample data, and the Dashboard, Clients, Client detail, Incidents, Checks, and Settings screens.
- **Phase 2 (basic HTTP monitoring): done.** Real HTTP checks (status code, response time, expected content), stored check history, a Monitor detail page, and a manual **Run check** button.

Checks run **only when someone clicks Run check**. Automatic incidents arrive in Phase 3, and scheduled checks in Phase 4. Running checks requires Supabase; on sample data the button is disabled.

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

Both Supabase variables must be set for the app to use Supabase. Settings shows which data source is active and which variable names it found.

### Deploying on Vercel with the Supabase integration

The app also accepts the names Vercel's Supabase Marketplace integration creates:

| Setting | Accepted names (first match wins) |
| --- | --- |
| Project URL | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` |
| Secret key | `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

1. In Vercel, go to **Project → Storage** (or **Integrations → Supabase**) and create a new Supabase database or connect an existing one to this project. Leave the environment variable prefix empty.
2. Run the migration and optional seed in that Supabase project's SQL Editor (see **Database setup** below).
3. Redeploy. The app's **Settings** page should show *Supabase* as the data source.

The integration also adds public anon/publishable keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY` and similar). The app doesn't use them, and RLS blocks them from reading any data.

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
| `npm test` | Unit tests for health rules, check evaluation and SSRF protection (Node's built-in test runner) |

## Project layout

```
src/
  app/                  Routes: dashboard, clients, clients/[id], monitors/[id], incidents, checks, settings
    actions.ts          Server action: Run check
  components/           Sidebar, status badges, shared tables, Run check button, UI primitives
  lib/
    data.ts             Loads data (Supabase or sample) and builds view models
    health.ts           Health rules: monitor → website → client roll-up
    monitoring/
      run-check.ts      Performs one HTTP check (redirects, timeout, body limit, error messages)
      evaluate.ts       Pure pass/fail rules for a check
      url-safety.ts     SSRF protection
      record.ts         Runs a check and saves the result
    sample-data.ts      Built-in sample data (mirrors supabase/seed.sql)
    supabase/server.ts  Server-only Supabase client
    types.ts            Row types matching the SQL schema
supabase/
  migrations/           SQL schema
  seed.sql              Sample data
```

## How checks work

Each check makes one `GET` request to the monitor's target URL and stores the result in `check_results`.

| Monitor type | Passes when | Otherwise |
| --- | --- | --- |
| HTTP Status | Status is 200–399, or exactly the monitor's *expected status* if one is set | Failed |
| Expected Content | Status passes **and** the expected text appears in the page's visible text | Failed |
| Response Time | Status passes **and** the full response takes no longer than *max response time* (default 3000 ms) | Warning (slow) |

Any monitor with *expected text* set also checks the text, whatever its type.

- **Redirects** are followed (up to 5), each one re-validated. If a monitor's expected status is a 3xx, redirects aren't followed, so the redirect itself is what gets checked.
- **Limits:** 15-second timeout, and at most 2 MB of the page is read.
- **Text matching** ignores case, HTML tags, extra whitespace and common HTML entities (`&nbsp;`, `&amp;`, curly quotes). Text that appears only inside `<script>` or `<style>` doesn't count.
- **Errors** (DNS, connection refused, SSL problems, timeouts) are stored as failed checks with a readable message.
- **Response time** covers the whole request, including redirects and downloading the page.
- Running a check updates the monitor's `last_checked_at` and `next_check_at`. Manual runs of the same monitor are limited to one every 10 seconds.

### Adding a real client and monitor

There's no "add monitor" screen yet. Until there is, add rows in the Supabase **SQL Editor**:

```sql
with c as (
  insert into clients (name, primary_website) values ('Acme Co', 'https://acme.com') returning id
), w as (
  insert into websites (client_id, name, url)
  select id, 'Main site', 'https://acme.com' from c returning id
)
insert into monitors (website_id, name, monitor_type, target_url, expected_text, interval_minutes, severity_on_failure)
select id, 'Contact Page', 'expected_content', 'https://acme.com/contact', 'Contact Us', 15, 'critical' from w;
```

Then open **Checks**, click the monitor, and press **Run check**.

## How health is determined

- **Monitor:** an open or investigating incident sets the monitor to that incident's severity. A snoozed or expected-maintenance incident makes it *informational*. With no incident, the latest check decides: passed → healthy, failed or slow → warning, no checks yet → no data.
- **Website / client:** the worst status among active monitors and active incidents. Anything inactive shows as inactive.
- Order: Critical > Warning > Informational > No data > Healthy.

## Security notes

- This is an internal tool, but **it has no login yet**. Before deploying anywhere reachable, put it behind Vercel Deployment Protection (or add authentication in a later phase).
- All database access runs server-side.
- **SSRF protection** (`src/lib/monitoring/url-safety.ts`): only `http`/`https` on ports 80, 443, 8080 or 8443; no credentials in URLs; no internal hostnames (`localhost`, `*.local`, single-word names). Every DNS answer is checked **at connection time**, so private, loopback, link-local (including the `169.254.169.254` cloud metadata address), CGNAT, multicast and reserved IPv4/IPv6 addresses are refused, even after a redirect or a DNS change.
- The Run check action accepts only a monitor ID and always fetches the URL stored in the database. It can't be used to request arbitrary addresses. Without a login, though, anyone who can reach the app can trigger checks of existing monitors, which is another reason to keep Deployment Protection on.
