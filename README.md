# Website Watch

**Figmints Website Health Monitor.** An internal tool for catching problems on client websites before the client notices them.

This app is for the Figmints team only. It has no client accounts, public pages, or billing.

## Status

- **Phase 1 (foundation): done.** App shell, database schema, sample data, and the Dashboard, Clients, Client detail, Incidents, Checks, and Settings screens.
- **Phase 2 (basic HTTP monitoring): done.** Real HTTP checks (status code, response time, expected content), stored check history, a Monitor detail page, and a manual **Run check** button.
- **Phase 3 (incident engine): done.** Incidents open and resolve automatically from check results. An Incident detail page offers status actions, team assignment and internal notes, and the Dashboard lists failing checks that don't have an incident yet.

- **Phase 4 (scheduled monitoring): done.** One scheduled worker, triggered every 5 minutes by Supabase `pg_cron`, checks every monitor that is due according to its interval. See **Scheduled checks**.
- **Staff login: done.** Google sign-in limited to `@figmints.com` accounts. See **Login**.
- **Phase 5 (operational improvements): done.** Add/edit clients, websites and monitors in the app (with bulk monitor setup), filters, timed snooze, website maintenance windows, uptime percentages, incident history, and automatic check-history cleanup.
- **Phase 9 (alerts): Slack done.** Critical incidents are posted to a Slack channel when they open and when they resolve. See **Alerts**. Email and Basecamp aren't built yet.

Running checks and updating incidents require Supabase. On sample data those controls are disabled.

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
| `SUPABASE_PUBLISHABLE_KEY` | For login | Supabase publishable (or legacy anon) key, used only for the login session. Also accepted: `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `ALLOWED_EMAIL_DOMAINS` | No | Comma-separated domains allowed to sign in. Default `figmints.com`. |
| `CRON_SECRET` | For scheduled checks | Random string (16+ characters) that the scheduler must send. See **Scheduled checks**. |
| `SLACK_WEBHOOK_URL` | For alerts | Slack Incoming Webhook (`https://hooks.slack.com/...`). **Secret.** No alerts are sent without it. |
| `APP_URL` | No | Public app address for "Open incident" links in alerts. On Vercel the production domain is detected automatically. |
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
2. Open **SQL Editor** and run each file in `supabase/migrations/` **in filename order**:
   - `20260922000000_initial_schema.sql`
   - `20260923000000_incident_engine.sql` (Phase 3)
   - `20260924000000_scheduler.sql` (Phase 4)
   - `20260925000000_operations.sql` (Phase 5)
   - `20260926000000_alerts.sql` (Phase 9)
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
| `incidents` | Meaningful problems: severity, status, team, timeline, internal notes, snooze end |
| `incident_events` | Incident history: who changed what, when (`system` for automatic changes) |
| `monitor_check_summary` (view) | Latest check and last successful check per monitor ("last known good") |
| `monitor_uptime` (view) | Passing checks / all checks per monitor over 24 hours, 7 days and 30 days |

Row-level security is enabled on every table with **no policies**. The public anon/publishable key can read nothing; only the server's secret key has access.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit tests for health rules, check evaluation, incident rules, alert rules, login rules, form validation and SSRF protection (Node's built-in test runner) |

## Project layout

```
src/
  proxy.ts              Login check before every request (refreshes the session)
  app/
    (app)/              Signed-in pages: dashboard, clients, monitors, incidents, checks, settings
    login/, auth/       Sign-in page, Google sign-in and sign-out actions, OAuth callback
    actions.ts          Server actions: Run check, Run due checks, incident status/snooze, team and notes
    manage-actions.ts   Server actions: create/edit clients, websites, monitors; maintenance windows
    api/cron/run-checks Scheduler endpoint (called by Supabase pg_cron)
  components/           Sidebar, status badges, shared tables, Run check button, UI primitives
  lib/
    data.ts             Loads data (Supabase or sample) and builds view models
    auth/               Who may sign in (allowed.ts) and the staff check (session.ts)
    health.ts           Health rules: monitor → website → client roll-up
    validation.ts       Form parsing/validation (SSRF-safe URLs, bulk monitor lines)
    notify/             Alerts: rules and Slack message format (alerts.ts), sending (send.ts)
    monitoring/
      run-check.ts      Performs one HTTP check (redirects, timeout, body limit, error messages)
      evaluate.ts       Pure pass/fail rules for a check
      url-safety.ts     SSRF protection
      incident-engine.ts Pure rules: when to open, update or resolve an incident
      record.ts         Runs a check, saves the result, applies incident rules
      scheduler.ts      Claims due monitors and checks them in parallel
    sample-data.ts      Built-in sample data (mirrors supabase/seed.sql)
    supabase/server.ts  Server-only Supabase client
    types.ts            Row types matching the SQL schema
supabase/
  migrations/           SQL schema (run in filename order)
  setup/                One-time setup scripts (scheduling)
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

## Managing clients, websites and monitors

Everything is managed in the app (Supabase must be connected):

- **Add a client:** **Clients → Add client**. Enter the name and main website, and list the pages to monitor, one per line. This creates the client, its production website and all the monitors in one go.
- **Add monitors in bulk:** a client page → **Add monitors**. Pick a website and list pages:
  ```
  /
  /contact | Contact Us
  /services
  https://shop.example.com/cart
  ```
  - A path is relative to the website. A full URL can point anywhere public.
  - Text after `|` makes it an **Expected Content** monitor that checks for that text. Without it, you get an **HTTP Status** monitor.
  - Names come from the path, e.g. `/free-estimate` becomes "Free Estimate Page". You can rename them afterwards.
  - Up to 25 lines at a time. New monitors are checked within 5 minutes.
- **Edit or pause a monitor:** the monitor's page → **Edit monitor**. Change its type, URL, expected status or text, response-time limit, interval or severity. Untick **Active** to pause it; re-activating makes it due right away.
- **Websites:** a client page → **Add website** (e.g. staging) or **Edit** next to a website. Untick **Active** to stop checking it.
- **Deactivate a client:** **Edit client** → untick **Active**. Its history is kept.

All URLs go through the same SSRF rules as the checks. Private addresses, `localhost`, unusual ports and non-http(s) URLs are rejected when you save.

### Maintenance windows

On a client page, each website has **Start maintenance** (1 hour, 4 hours, 24 hours, 3 days or 7 days, plus an optional note). While the window is open:

- Checks keep running, so the history stays complete.
- New incidents open as **Expected Maintenance** instead of alerting, and stay out of **Needs attention**.
- The client shows an "In maintenance" tag.

**End maintenance** closes it early. When it ends, new problems alert as usual. Incidents opened during the window stay as they are until resolved.

### Uptime

Uptime is the share of passing checks, from the `monitor_uptime` view:

- **Monitor page:** last 24 hours, 7 days and 30 days.
- **Monitor tables and the Clients list:** 7 days.
- **Client page:** 7 days across the client's active monitors.
- **Dashboard:** overall 7-day figure.

A slow (warning) check counts as not passing. Uptime is rounded down, so a real failure never shows as 100%.

## How incidents work

An incident is a confirmed problem, not a single failed request. After every check, the incident engine (`src/lib/monitoring/incident-engine.ts`) looks at the monitor's recent checks:

| Situation | What happens |
| --- | --- |
| 1 failed or slow check | Nothing yet. The Dashboard lists it under **Failing checks, no incident yet**. |
| 2 failed or slow checks in a row, no unresolved incident | **Incident opens**. *First detected* is the first failure in the streak. |
| Still failing with an incident | The incident's *last detected* time and description update. Severity can go up (slow → down), never down. |
| 1 success | Nothing yet. One good check isn't enough. |
| 2 successes in a row | **Incident resolves** automatically, whatever its status (Open, Investigating, Snoozed, Expected Maintenance). |

- **Severity:** a failed check uses the monitor's *severity on failure*. A slow response is at most **Warning**.
- **Titles** describe the failure, e.g. "Contact Page returning HTTP 500", "Expected content missing on Contact Page", "Homepage is unreachable".
- **Ignored** incidents stay out of the Needs attention list. While one is unresolved, continued failures don't open new incidents. When the site recovers it's closed, but keeps the *Ignored* status so the history shows nobody acted on it.
- **Only one unresolved incident per monitor.** A database index enforces this, so two checks finishing together can't open duplicates.

### Incident actions

On an incident's page (click any incident title):

- **Status:** Mark Investigating, Expected Maintenance, Ignore, Reopen, Resolve. A resolved incident is history and can't be reopened. If the problem returns, a new incident opens automatically.
- **Snooze for** 1 hour, 4 hours, 24 hours or 7 days. When the time is up, the scheduler reopens it as **Open**, and it's back on the Dashboard.
- **Assigned team:** Development, Account Management, SEO, Ads, Client or Unassigned.
- **Internal notes:** free text, up to 5,000 characters. Editable even after an incident is closed.

Snoozed and Expected Maintenance incidents drop out of **Needs attention** and show as informational (gray).

### Incident history

Each incident page has a **History** timeline. It records who (staff email, or *Website Watch (automatic)*) did what and when:
- **Automatic:** opened, severity raised, resolved, snooze ended.
- **By staff:** status changes, snoozes, team assignment, note edits.

### Filters

- **Incidents:** client, severity, team, plus the Active / Resolved & ignored / All tabs.
- **Clients:** name or website search, and health (needs attention, healthy, maintenance/no data, inactive).

Filters are part of the URL, so a filtered view can be bookmarked or shared.

## How health is determined

- **Monitor:** an open or investigating incident sets the monitor to that incident's severity. A snoozed or expected-maintenance incident makes it *informational*. With no incident, the latest check decides: passed → healthy, failed or slow → warning, no checks yet → no data.
- **Website / client:** the worst status among active monitors and active incidents. Anything inactive shows as inactive.
- Order: Critical > Warning > Informational > No data > Healthy.

## Scheduled checks

One scheduled worker checks every monitor that's due. There are no per-website cron jobs.

1. Every **5 minutes**, Supabase's built-in scheduler (`pg_cron`) calls `POST /api/cron/run-checks`, authenticated with `CRON_SECRET`.
2. The endpoint **claims** up to 20 due monitors with the `claim_due_monitors` database function. "Due" means active monitor, website and client, with *next check* now or within the next minute. Claiming locks those monitors for 5 minutes, so overlapping or duplicate calls never check the same monitor twice.
3. It checks them 5 at a time. Each check is saved, incident rules are applied, and *next check* is set to now + the monitor's interval.
4. If time runs short (40 s), the remaining claimed monitors are picked up by the next run. With more than 20 due monitors, the backlog drains over the following runs.
5. **Housekeeping:** every run reopens snoozes that have expired. Once an hour, it deletes check results older than **90 days**.

**Intervals:** 5 min, 15 min, 30 min, 1 hour, 6 hours, or daily (enforced by the database). A new monitor with no *next check* is due right away.

**Why Supabase and not Vercel Cron?** On Vercel's Hobby plan, cron jobs can run only once a day, and a more frequent schedule makes deployments fail. On Pro you could instead add a `crons` entry to `vercel.json` pointing at `/api/cron/run-checks` (Vercel sends `CRON_SECRET` automatically).

### Setting it up (once)

1. **Run the migration** `supabase/migrations/20260924000000_scheduler.sql` in the Supabase SQL Editor.
2. **Create a secret:** run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and copy the output.
3. **Add it to Vercel:** Project → Settings → Environment Variables → `CRON_SECRET` = that value (Production, Sensitive). Redeploy.
4. **If production uses Vercel Authentication** (Deployment Protection → *All Deployments*): Deployment Protection → **Protection Bypass for Automation** → create a secret. Scheduled calls come from Supabase, not a logged-in user, so they need it.
5. **Schedule it:** open `supabase/setup/schedule-checks.sql`, replace the three placeholders (production URL, `CRON_SECRET`, bypass secret), and run it in the Supabase SQL Editor. The values are stored encrypted in Supabase Vault. Don't commit a filled-in copy.
6. **Verify:** within 5 minutes, **Settings → Scheduled checks** should show a recent *Most recent check*, and monitors should show *Next check* times. The bottom of `schedule-checks.sql` has queries for troubleshooting (run history, HTTP responses).

**Settings → Run due checks now** runs the same worker immediately, which is useful for testing or catching up. For local development you can also call the endpoint directly:

```bash
curl -X POST http://localhost:3000/api/cron/run-checks -H "Authorization: Bearer $CRON_SECRET"
```

## Alerts

Website Watch posts to **one Slack channel**. It's deliberately quiet, so people keep paying attention to it:

| What happens | Slack message |
| --- | --- |
| A **Critical** incident opens (2 failed checks in a row) | :red_circle: `[CRITICAL] Client — Problem`, with the monitor, first detected time, error and an **Open incident** button |
| A Warning incident **escalates** to Critical | :red_circle: same, noted "Escalated from Warning" |
| A snoozed Critical incident **reopens** when its snooze ends | :red_circle: same, noted "Still failing after snooze" |
| An alerted incident **resolves** (automatically or by someone) | :large_green_circle: `[RESOLVED] Client — Problem`, with how long it lasted and who resolved it |

- **Never alerted:** Warnings, Expected Maintenance (including anything that opens during a maintenance window), Snoozed and Ignored incidents. They're on the Dashboard only.
- **At most one alert per incident.** A resolution message is only sent for incidents that were alerted.
- **Every alert shows in the incident's History,** as "Slack: alert posted" or "Slack alert failed: …".
- **A failed alert is retried** on the incident's next change.

### Setting up Slack (once)

1. In Slack: **Apps → Incoming Webhooks** (or create an app at api.slack.com → *Incoming Webhooks*) → **Add to Slack** → pick the channel, e.g. `#website-alerts`. Copy the webhook URL (`https://hooks.slack.com/services/...`).
2. Add it as `SLACK_WEBHOOK_URL`:
   - **Vercel:** Settings → Environment Variables, Production, **Sensitive**, then redeploy.
   - **Local:** add it to `.env.local` if you want local testing to post too. Leave it out otherwise, so local experiments stay quiet.
3. Run the migration `20260926000000_alerts.sql` in Supabase.
4. In the app, go to **Settings → Alerts → Send test alert**. A test message should appear in the channel.

The webhook URL lets anyone post to that channel, so treat it like a password. If it leaks, remove the webhook in Slack and create a new one.

## Login

Staff sign in with **Google**. Only accounts on an allowed domain (`figmints.com` by default) get in. Everyone else is sent back to the login page.

- **Where it's enforced:**
  - `src/proxy.ts` runs before every page and action. It refreshes the session and redirects anyone who isn't signed-in staff to `/login`.
  - Every page and data load checks again (`requireStaff()` in `src/lib/auth/session.ts`), and so does every server action.
- **Who counts as staff:** signed in **with Google** (Google verifies the email) **and** the email's domain exactly matches `ALLOWED_EMAIL_DOMAINS`. Google's `hd` hint pre-selects the Figmints account, but the domain is enforced on the server, not by Google.
- **Keys:** the sign-in flow runs on the server and uses the Supabase **publishable** key only for the session cookie. Data is still read with the secret key, on the server, after the staff check. No key is sent to the browser.
- **Sample-data mode** (no Supabase) has no login, because there's no real data to protect.
- **The scheduler endpoint** (`/api/cron/run-checks`) doesn't use login; it has its own `CRON_SECRET`.
- **If Supabase is connected but the publishable key is missing,** the app locks everything and the login page says why. It never falls open.

### Setting up Google sign-in (once)

1. **Google Cloud Console → APIs & Services**
   - **OAuth consent screen:** User type **Internal**, which limits sign-in to your Google Workspace. App name: *Website Watch*.
   - **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized redirect URI:** `https://<your-project-ref>.supabase.co/auth/v1/callback`. Find it in Supabase → Authentication → Sign In / Providers → Google, labeled *Callback URL*.
   - Copy the **Client ID** and **Client secret**.
2. **Supabase → Authentication → Sign In / Providers → Google:** enable it and paste the Client ID and secret.
3. **Supabase → Authentication → URL Configuration:**
   - **Site URL:** `https://figmints-alert-system.vercel.app`
   - **Redirect URLs:** add `https://figmints-alert-system.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`
4. **Recommended:** Supabase → Authentication → Sign In / Providers → **Email**: turn it off. Only Google sign-ins are accepted anyway, but this stops stray email sign-ups.
5. **Environment variables:**
   - **Vercel:** the Supabase integration already provides `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`). Optionally set `ALLOWED_EMAIL_DOMAINS`.
   - **Local `.env.local`:** add `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` from Supabase → Project Settings → API Keys.
6. **Deploy, and check:** open the app. You should land on the Figmints sign-in page, and your `@figmints.com` Google account should get you in. Your name appears at the bottom of the sidebar, with **Sign out**.
7. **Then turn off Vercel Authentication** (Deployment Protection) so colleagues can reach the login page. Keep the automation bypass secret; it's harmless once protection is off. If you prefer to keep protection on as a second layer, only people with access to the Vercel project will be able to open the app.

## Security notes

- **Login is required** for every page and action when Supabase is connected (see **Login**). Sample-data mode has no login.
- All database access runs server-side.
- **SSRF protection** (`src/lib/monitoring/url-safety.ts`): only `http`/`https` on ports 80, 443, 8080 or 8443; no credentials in URLs; no internal hostnames (`localhost`, `*.local`, single-word names). Every DNS answer is checked **at connection time**, so private, loopback, link-local (including the `169.254.169.254` cloud metadata address), CGNAT, multicast and reserved IPv4/IPv6 addresses are refused, even after a redirect or a DNS change.
- The Run check action accepts only a monitor ID and always fetches the URL stored in the database. It can't be used to request arbitrary addresses. Only signed-in staff can run it.
- The scheduler endpoint refuses every request unless `CRON_SECRET` (16+ characters) is set and sent as `Authorization: Bearer …`. The comparison is constant-time. It only checks monitors already in the database.
- Alerts are only posted to a `hooks.slack.com` webhook from `SLACK_WEBHOOK_URL`. Client names, titles and errors are escaped before they go into Slack formatting.
- `claim_due_monitors` can only be called with the secret key; execution is revoked from the public `anon` and `authenticated` roles.
