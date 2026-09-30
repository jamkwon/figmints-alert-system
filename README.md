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
- **Phase 9 (alerts): Slack done.** Critical incidents are posted to a Slack channel when they open and when they resolve, and a **weekly summary** goes out once a week. See **Alerts**. Email and Basecamp aren't built yet.
- **Phase 8 (advanced monitoring): SSL certificate expiry done.** An *SSL Certificate* monitor warns before a site's certificate expires. See **SSL certificates**.
- **Phase 8: broken link scans done.** A *Broken Links* monitor scans a page's links, images, stylesheets and scripts. See **Broken link scans**.
- **Phase 8: tracking tag checks done.** A *Tracking Tags* monitor makes sure GTM, GA4, Google Ads, Meta Pixel, LinkedIn Insight and HubSpot tags stay on a page. See **Tracking tags**.
- **Phase 7 (WordPress / WP Engine), Stage A: done.** A *WordPress Health* monitor checks WordPress and PHP versions, visible plugins, and WP Engine install status and backups. See **WordPress health**. Evaluation: `docs/phase-7-wordpress-evaluation.md`.
- **Phase 7: import from WP Engine done.** **Clients → Import from WP Engine** adds production sites from WP Engine as clients, with uptime, SSL and WordPress checks. See **Importing sites from WP Engine**.
- **Phase 7, Stage B (WordPress plugin): done.** An optional plugin (it never changes the site) lets WordPress Health checks see every plugin and theme with its available update (premium included), exact WordPress/PHP versions, debug mode, WP-Cron, **fatal PHP errors** and **failed emails**. See **WordPress plugin**.
- **Search visibility and domain expiry: done.** A *Search Visibility* monitor fails if a production site tells search engines not to index it or robots.txt blocks it; a *Domain Expiry* monitor warns before the domain registration runs out. See **Search visibility** and **Domain expiry**.
- **Page speed: done.** A *Page Speed* monitor runs Google PageSpeed Insights (mobile) daily and warns when the performance score drops below a minimum or real visitors' Core Web Vitals fail. See **Page speed**.
- **Monthly client report: done.** A printable report per client and month (uptime, incidents, WordPress work done, page speed, security). See **Monthly report**.
- **Contact form checks: done.** A *Contact Form* monitor fails when a page's form is missing or broken (any form tool), or when the site's emails fail to send (WordPress plugin 1.3+). See **Contact forms**.
- **Trends and automatic reports: done.** 90-day **uptime history** bars (monitor and client pages, and daily bars in the monthly report), a **page speed trend** chart with a warning on sharp drops, and last month's client reports **posted to Slack on the 1st**. See **Uptime history**, **Page speed** and **Monthly report**.
- **Known vulnerabilities: done.** A *Vulnerabilities* monitor compares each WordPress site's core, plugin and theme versions with the Wordfence Intelligence list (downloaded daily), and alerts on serious ones that need no login. See **Vulnerabilities**.

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
| `WPENGINE_API_USER` / `WPENGINE_API_PASSWORD` | For WP Engine data | API credentials from my.wpengine.com → API Access. **Secret.** Used read-only (installs and backups). |
| `WEBSITE_WATCH_PLUGIN_KEY` | For the WordPress plugin | Private key (64 hex characters) that signs requests to the site plugin. **Secret.** Changing it means re-installing the plugin. `WEBSITE_WATCH_PLUGIN_TOKEN` (its earlier name) also works. |
| `WEBSITE_WATCH_TEST_EMAIL` | No | Address the WordPress plugin sends one test email a day to (e.g. `websitewatch@figmints.com`), to prove sites can send email. Built into the plugin at download. |
| `PAGESPEED_API_KEY` | For Page Speed monitors | Google API key for PageSpeed Insights. See **Page speed**. Without it, those checks only say it's missing. |
| `WORDFENCE_API_KEY` | For Vulnerabilities monitors | Wordfence Intelligence API key (free wordfence.com account). **Secret.** Set it in **Production only**: the key has a download limit that local and preview copies would use up. See **Vulnerabilities**. |
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
   - `20260927000000_ssl_expiry.sql` (Phase 8, SSL)
   - `20260928000000_broken_links.sql` (Phase 8, broken links)
   - `20260929000000_tracking_tags.sql` (Phase 8, tracking tags)
   - `20260930000000_wordpress_health.sql` (Phase 7, WordPress health)
   - `20261001000000_weekly_summary.sql` (Phase 9, weekly summary)
   - `20261002000000_app_settings.sql` (editable monitoring rules)
   - `20261003000000_seo_domain.sql` (Search Visibility and Domain Expiry monitors)
   - `20261004000000_page_speed.sql` (Page Speed monitors; minimum score setting)
   - `20261005000000_weekly_monthly_intervals.sql` (Weekly and Monthly check intervals)
   - `20261006000000_contact_form.sql` (Contact Form monitors)
   - `20261007000000_daily_uptime.sql` (uptime history: per-day totals)
   - `20261008000000_monthly_report_posts.sql` (monthly reports in Slack)
   - `20261009000000_uptime_speed.sql` (faster uptime numbers)
   - `20261010000000_vulnerabilities.sql` (Vulnerabilities monitors, added to every site with WordPress Health)
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
| `wp_vulnerabilities` | Known vulnerabilities from Wordfence: one row per affected version range, replaced daily |
| `vulnerability_feed` | When the vulnerability list was last downloaded, and the last error |

Row-level security is enabled on every table with **no policies**. The public anon/publishable key can read nothing; only the server's secret key has access.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit tests for health rules, check evaluation (HTTP, SSL, broken links, tracking tags, WordPress), incident rules, alert rules, login rules, form validation and SSRF protection (Node's built-in test runner) |

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
    notify/             Alerts: rules and Slack message format (alerts.ts), sending (send.ts),
                        weekly summary (weekly.ts, weekly-send.ts), monthly reports (monthly.ts, monthly-send.ts)
    monitoring/
      run-check.ts      Performs one HTTP check (redirects, timeout, body limit, error messages)
      evaluate.ts       Pure pass/fail rules for a check (HTTP and SSL)
      links.ts          Broken link scans: which links to check, what counts as broken
      tracking.ts       Tracking tag detection (GTM, GA4, Google Ads, Meta, LinkedIn, HubSpot)
      wordpress.ts      WordPress detection, version compare, backup/PHP rules
      wpengine.ts       WP Engine API client (read-only: sites, installs, backups)
      wpengine-import.ts  Which WP Engine installs aren't monitored yet (import page)
      wp-plugin.ts      The Website Watch Health WordPress plugin (PHP source, request signing)
      visibility.ts     noindex, robots.txt (Google's rules) and canonical checks
      domain.ts         Domain expiry from the registry's RDAP service
      pagespeed.ts      Google PageSpeed Insights: score, lab and real-user metrics, rules
      forms.ts          Contact forms on a page (any builder) and the site's email health
    report.ts           Monthly client report: months, uptime, incidents, WordPress work done
    uptime-history.ts   Per-day uptime bars (90 days, or a report's month)
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
| Response Time | Status passes **and** the full response takes no longer than *max response time* (default 3000 ms, changeable in **Settings**) | Warning (slow) |
| WordPress Health | No backup problems and nothing out of date | Failed on backup problems (uses the monitor's severity; default Critical); Warning for outdated WordPress, PHP or plugins |
| Tracking Tags | The page loads and every expected tag is in its HTML | Failed, naming the missing tags (uses the monitor's severity; default Warning) |
| Search Visibility | The page doesn't say noindex, robots.txt doesn't block it, and its canonical URL is on the same domain | Failed when search engines are kept out (monitor severity, Critical by default); Warning for a robots.txt error or a canonical on another domain |
| Domain Expiry | The domain registration has more than 30 days left | Warning at 30 days or less; Failed at 7 days or less, expired, or in its redemption period |
| Contact Form | A usable form is on the page (any form tool), and, with the plugin, the site's emails send | Failed when the form is missing or broken, or emails failed in the last 24 hours / the daily test email failed (monitor severity, Critical by default) |
| Page Speed | Google PageSpeed performance score (mobile) at or above the minimum in Settings (default 50), and real visitors' Core Web Vitals passing | Warning only (never Failed: a slow page isn't an outage) |
| Broken Links | The page loads and none of its first 40 links/images/stylesheets/scripts are broken | Warning when any are broken; Failed only if the page itself doesn't load |
| SSL Certificate | The certificate is trusted, matches the domain, and has more than 14 days left | Warning at 14 days or less; Failed at 3 days or less, or when expired, untrusted or for the wrong domain (both day limits in **Settings**) |

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
- **Add one monitor with every setting:** a client page → **Add monitors** → **One monitor (all settings)** tab. Choose the website, type, URL and that type's settings (expected status/text, response-time limit, tracking tags, interval, severity) in one step. Name is optional; it's taken from the page if left blank.
- **Edit or pause a monitor:** the monitor's page → **Edit monitor**. Change its type, URL, expected status or text, response-time limit, interval or severity. Untick **Active** to pause it; re-activating makes it due right away.
- **Websites:** a client page → **Add website** (e.g. staging) or **Edit** next to a website. Untick **Active** to stop checking it.
- **Deactivate a client:** **Edit client** → untick **Active**. Its history is kept.

All URLs go through the same SSRF rules as the checks. Private addresses, `localhost`, unusual ports and non-http(s) URLs are rejected when you save.

### SSL certificates

An **SSL Certificate** monitor opens a secure connection to the website (port 443), reads the certificate, and hangs up. It doesn't load the page.

- **Adding one:** tick **Also check the SSL certificate** on **Add client** or **Add monitors**. It's checked every 6 hours, and each website gets at most one.
- **When it warns or fails:**
  - **Warning** at 14 days left, which opens a Warning incident after 2 checks (never alerts on Slack).
  - **Failed** at 3 days left, or when the certificate is expired, untrusted, self-signed or for the wrong domain. That uses the monitor's severity (Critical by default), so it alerts.
- **Where you see it:** the expiry date and days left appear in monitor tables and on the monitor page, along with the issuer.
- **Uptime:** SSL monitors don't count toward uptime, because an expiring certificate isn't downtime.
- **Safety:** the connection uses the same SSRF protection as page checks.

### WordPress health

A **WordPress Health** monitor combines three sources:

1. **Public signals** (every WordPress site): the WordPress version (from the RSS feed, meta generator, or asset versions), themes, and plugins visible in page assets or the REST API index.
2. **WordPress.org:** the latest WordPress release, and the latest version of free plugins whose version the page reveals.
3. **WP Engine API** (sites on WP Engine, once connected): the install serving the site's domain, with its WordPress and PHP versions, status, whether upgrades are deliberately deferred, and **backups**.

| Result | When |
| --- | --- |
| **Failed** (monitor severity, Critical by default, so it posts to Slack) | No completed WP Engine backup in **48 hours**, none at all, or the **latest backup was aborted** |
| **Warning** | WordPress older than the latest release (unless upgrades are deferred on WP Engine), PHP below 8.2, WP Engine install not active, plugins with updates, or WordPress not detected |

The backup limit, the minimum PHP version (or not checking PHP) and whether available updates count as a Warning can be changed in **Settings → Monitoring rules**; the values above are the defaults.

- **Adding one:** tick **Also check WordPress health** on **Add client** or **Add monitors**. It's checked every 6 hours, one per website. The **One monitor** tab also offers the *WordPress Health* type.
- **Where you see it:** the monitor page's **WordPress** panel shows the versions and where they came from, PHP, the WP Engine install, the last backup, the theme, and each visible plugin with its version and any update.
- **Limits:** without the **WordPress plugin**, plugin updates are only known for free wordpress.org plugins whose version is visible from outside. Install the plugin on a site to see all of them, premium included. Sites not on WP Engine get no backup data.

#### WordPress plugin

**Website Watch Health** is a small **WordPress plugin** that reports on the site without changing it. With it, a WordPress Health check also knows:

- **every plugin and theme**, active or not, with the update WordPress offers, **including premium plugins** that use WordPress's update system with a valid license (Gravity Forms, ACF Pro, Events Calendar Pro…);
- the exact WordPress and PHP versions and PHP memory limit;
- whether **debug errors are shown to visitors**, and whether **WP-Cron** is running;
- **fatal PHP errors** (plugin 1.2+): the crashes that show visitors WordPress's "There has been a critical error" page, with the plugin or theme at fault.

**PHP errors:** WordPress keeps no log of fatal errors (it only emails the admin, at most daily), so the plugin records them as they happen: the last 7 days, up to 20 distinct errors, each with how many times it happened (approximate: at most one write every 10 seconds, so an error flood can't flood the database). Only the first line of the message is kept (no stack traces), with server paths shortened to `wp-content/…`. Any fatal error in the last **24 hours** makes the check **fail** (Critical by default, so Slack hears about it), named after the plugin or theme at fault; older ones stay listed on the monitor page and in the weekly summary. Errors from before the plugin was installed (or updated to 1.2) can't be seen. Deactivating the plugin deletes its error log.

Extra warnings when it's installed: theme updates, debug errors shown to visitors, WP-Cron more than 2 hours behind, and WordPress not having checked for updates in 3 days (its update list would be stale). Plugin updates count toward the existing "plugins with updates available" warning.

**How it stays safe**

- **Never changes the site.** It only reads what WordPress's own update checks already stored. It never updates, installs or changes content or settings, never calls out to other services, and takes no input besides two request headers. It writes only its own notes: a short-lived record of each signature it accepted (to refuse replays; cleared after 10 minutes), the fatal PHP error log, and the email log (failures and last send; non-autoloaded options, throttled). The only thing it sends is the optional daily test email, to the fixed address built into it (1.3+).
- **Signed requests.** Website Watch signs every request with an **Ed25519 private key** that never leaves Website Watch. The plugin holds only the matching **public key**, so the plugin file contains no secret: copying it gives an attacker nothing.
- **Each signature is tied to one site, one moment, one use.** It covers `https://` plus the site's own domain (taken from WordPress's settings, not the request), and a timestamp the plugin accepts for 5 minutes, and the plugin accepts it only once. A captured request, or one sent to the wrong server (a redirect, an expired domain), is useless on any other site, over plain HTTP, later, or a second time. "Only once" is enforced by the database (1.4+): two copies arriving at the same instant can't both get through. Website Watch only contacts the plugin over HTTPS and never follows redirects with these requests.
- **Updating from 1.3 or older:** Website Watch still sends the older signature too, so older plugins keep working until updated. The monitor page shows when a newer plugin version is available. Download it from Settings and upload it in WordPress (Plugins → Add New Plugin → Upload Plugin → *Replace current with uploaded*).
- **One narrow endpoint:** `POST /wp-json/website-watch/v1/status`. Everything else gets `401`, GET isn't answered, and responses carry `no-store` so no page cache (including WP Engine's) keeps a report. The endpoint isn't listed in the site's public `/wp-json/` index, and opening the plugin file directly shows nothing.
- **Never replaced by a stranger's plugin.** It declares `Update URI: false`, so WordPress never offers a wordpress.org plugin with the same folder name as an "update" for it.
- **Can't break a site by being installed twice.** Two copies (e.g. in different folders) load only once, instead of a PHP "cannot redeclare" crash.
- **Tested** on WordPress 7.1 / PHP 8.3 and WordPress 6.8 / PHP 7.4 (fatal errors before output, after output and uncaught exceptions are all recorded) against: no or garbage signature, wrong key, tampered signature or timestamp, signatures for another site or for plain HTTP, the older signature alone, 10 minutes old or in the future, replay (including six copies at once), oversized headers, GET, and two copies installed. All refused, or handled, as expected.

**Setting it up (once)**

1. Create a private key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (64 hex characters).
2. Add it as `WEBSITE_WATCH_PLUGIN_KEY` in Vercel (Production, **Sensitive**) and in `.env.local`. Redeploy. Use the **same** value in both, so a plugin downloaded locally also works for production.
3. **Settings → WordPress plugin → Download** `website-watch-health.zip`. The public key is already inside.

**Installing it on a site**

- **One site:** in WordPress admin, **Plugins → Add New Plugin → Upload Plugin**, choose `website-watch-health.zip`, **Install Now**, then **Activate**.
- **Many sites on WP Engine:** with SSH Gateway access (WP-CLI is available there), per install:
  ```bash
  scp website-watch-health.zip INSTALL@INSTALL.ssh.wpengine.net:sites/INSTALL/
  ssh INSTALL@INSTALL.ssh.wpengine.net "cd sites/INSTALL && wp plugin install website-watch-health.zip --activate && rm website-watch-health.zip"
  ```
- It shows in the site's plugins list as **Website Watch Health**, so anyone with admin access can deactivate or delete it. Checks then fall back to public signals and the monitor page says the plugin isn't installed.
- **Check it:** on the next WordPress Health check, the monitor page's **Site plugin** row says *Reporting*. **Run check** to see it right away.

**Updating it:** WordPress won't update it automatically (see `Update URI` above). Upload the new zip; WordPress offers **Replace current with uploaded**.

If you change the key, download the plugin again and re-install it on every site; until then those sites show *rejected the request* and fall back to public signals. A site whose clock is more than 5 minutes off is also refused. To remove it, deactivate and delete it in **Plugins**.

#### Connecting WP Engine (once)

1. Create a dedicated WP Engine user, e.g. `websitewatch@figmints.com`, with **Full (no billing)** access: **Users → Account Users → Invite account user**.
2. As the account **Owner**: **Users → API Access** → switch the account **On**.
3. Logged in as the dedicated user: **API Access → Generate Credentials**. Store them in a password manager.
4. Add `WPENGINE_API_USER` and `WPENGINE_API_PASSWORD` in Vercel (Production, **Sensitive**), and in `.env.local` for local use. Redeploy.
5. **Settings → WP Engine** should say *Connected · N installs*. Installs are matched to websites by domain automatically (the primary domain, ignoring `www.`, or the `*.wpengine.com` address).

Website Watch only **reads** from WP Engine: it lists sites, installs and backups. It never creates backups or changes anything.

#### Importing sites from WP Engine

**Clients → Import from WP Engine** (also linked from **Settings → WP Engine**) lists every **production** install:

- **Ticked by default:** installs with a real domain that aren't monitored yet. Installs with only a `*.wpengine.com` / `*.wpenginepowered.com` address (usually not launched) and sandbox sites are listed but unticked. Search and **Select all shown / Clear shown** help with the rest.
- **Client name:** starts as the WP Engine site name, which is often a short internal name. Edit it before importing. If a client with that name already exists, the site is added to it.
- **Already monitored:** installs whose domain (or `*.wpengine.com` address) matches an existing website are hidden, and can't be imported twice.
- **Checks added to each site:** homepage uptime (interval of your choice), SSL certificate and WordPress health (every 6 hours), with the severity you pick. First checks are spread over each interval, so the scheduler isn't flooded.
- The page shows how many **scheduled checks a day** the import adds, and warns when that's more than the scheduler can run (see **Checking many sites**).

Domains always come from WP Engine on the server, never from the form, and go through the same URL safety rules as every other check.

### Search visibility

A **Search Visibility** monitor makes sure a production site hasn't quietly disappeared from Google. It's easy to happen on WordPress: copying staging to production can bring WordPress's **"Discourage search engines from indexing this site"** setting along with it.

- **Failed** (monitor severity, Critical by default, so it posts to Slack):
  - the page says **noindex** (or `none`) in a `<meta name="robots">` / `googlebot` tag, which is what WordPress's "Discourage search engines" adds, or in an `X-Robots-Tag` header;
  - **robots.txt blocks** the page for Googlebot, following Google's rules (the most specific user-agent group, the longest matching rule, a tie goes to Allow; an empty `Disallow:` allows everything).
- **Warning:** robots.txt answers a server error or can't be reached (Google pauses crawling then), or the page's **canonical URL points to another domain** (e.g. still the staging site). A missing robots.txt (404) is fine.
- **Adding one:** tick **Also check that search engines can index the homepage** on **Add client** or **Add monitors**. It's only added to **production** websites, because staging sites are meant to be hidden. Checked every 6 hours.

### Domain expiry

A **Domain Expiry** monitor watches when the site's domain registration runs out. An expired domain takes the website *and* email down.

- It asks the domain's registry through **RDAP** (the modern, public WHOIS). No account or key: IANA publishes which registry serves each ending (`.com`, `.org`, `.co.uk`...), and that list is cached for a day. It looks up the registered name, so `www.shop.example.co.uk` checks `example.co.uk`.
- **Warning** at **30 days** left; **Failed** at **7 days** or less, when expired, or in the registry's *redemption period*.
- The monitor page shows the expiry date, days left, registrar and registry status (e.g. *client transfer prohibited*, which means the domain is locked against unauthorized transfers).
- The **weekly summary** lists domains expiring within **60 days**, earlier than the warning.
- A few endings (e.g. `.io`) have no RDAP service: the check then says so as a Warning, and can be deleted.
- **Adding one:** tick **Also watch the domain's registration expiry** on **Add client** or **Add monitors**. Checked daily.

### Contact forms

A **Contact Form** monitor watches a page with a form (use the contact page's URL; add it as a *Contact Form* monitor from **Add monitors → One monitor**). It **never submits the form**, so there are no fake leads, emails or CRM entries.

**1. The form is there and usable** (any site). It finds real forms with fields and a submit button and recognizes **Gravity Forms, Contact Form 7, WPForms, Formidable, Elementor**, plain HTML forms, and forms drawn by scripts (**HubSpot**, **Ninja Forms**). Site search forms are ignored. **Failed** when:
- there's no form on the page, or it has no submit button;
- the form tool says the form can't be found (e.g. Gravity Forms' "We could not locate your form", Contact Form 7's 404);
- a form **shortcode shows as text**, e.g. `[gravityform id="6"]` (its plugin was deactivated);
- a HubSpot form's script doesn't load;
- **HubSpot says the form doesn't exist (deleted) or isn't published.** For HubSpot forms (both the classic `hbspt.forms.create` embed and the newer `hs-form-frame` one), the check asks HubSpot for the form's public definition, the same one the embed loads (`forms.hsforms.com/embed/v3/form/{portal}/{form}/json`, or `forms-eu1…` for EU accounts). If HubSpot itself doesn't answer, that's only noted, not failed.

**2. The site can send email** (WordPress sites with the Website Watch plugin, 1.3+). Almost every WordPress form tool sends notifications through WordPress's mailer, so the plugin records every email that **fails to send** (the reason only, e.g. "SMTP Error: Could not authenticate."; addresses are masked and no content is kept) and when an email last went out. **Failed** when an email failed in the last 24 hours. This catches the most common real breakage: expired email/SMTP settings, where entries are saved but nobody is notified.

- **Daily test email (optional):** set `WEBSITE_WATCH_TEST_EMAIL` (e.g. `websitewatch@figmints.com`), download the plugin again and re-install it. Each site then sends one short test email a day to that address (via WP-Cron) and reports whether it worked, so broken email is caught even on days nobody fills in the form. **Failed** if it fails; **Warning** if it hasn't run for 2 days (WP-Cron not running).
- **HubSpot forms** are submitted to HubSpot and emailed by HubSpot, so part 2 doesn't apply to them; part 1 covers the form being on the page and live in HubSpot. Who receives HubSpot's notifications, and whether submissions keep arriving, would need the HubSpot API.

The weekly summary lists contact form and email problems, and the monthly report says whether the form and email worked all month.

### Page speed

A **Page Speed** monitor runs **Google PageSpeed Insights** on a page once a day, with the **mobile** profile (Google ranks sites mobile-first). It reports two things:

- **Lab test (Lighthouse):** the 0–100 performance score, and load timings (Largest Contentful Paint, First Contentful Paint, Total Blocking Time, Cumulative Layout Shift). **Warning** when the score is below the minimum in **Settings → Monitoring rules** (default 50).
- **Real visitors (Chrome UX Report):** Core Web Vitals (LCP, INP, CLS) at the 75th percentile over the last 28 days, for the page or, with less traffic, the whole site. **Warning** when the assessment fails (any of them not "good"). Low-traffic sites may have no real-visitor data; then only the lab test counts.

- **Sharp drop:** **Warning** when the score is at least **15 points** below its median over the previous 7 days, e.g. "Score dropped to 48 from about 66 last week" (Lighthouse scores wobble by a few points, so smaller changes are ignored).

The monitor page has a **score trend** chart for the last 90 days, with Google's good / needs work / poor bands and the minimum from Settings.

It **never fails or alerts on Slack**: a slow page isn't an outage. Warnings show on the dashboard and in the **weekly summary** (*Page speed*). The monitor page shows the score, timings, real-visitor results, the three biggest suggested fixes, and a link to Google's full report.

- **Adding one:** tick **Also test the homepage's speed with Google PageSpeed** on **Add client** or **Add monitors**, or add a *Page Speed* monitor for any page. Daily.
- **Timing:** a test takes 10–40 seconds (Google loads the page). The scheduler starts page speed checks only at the beginning of a run, so every run still ends within Vercel's 60 s limit.
- **Scores vary** a few points between runs; that's normal for Lighthouse.

#### Getting the API key (once)

Google's keyless allowance is shared by everyone and is usually used up, so a key is needed. It's free (25,000 tests a day).

1. Go to **console.cloud.google.com** (signed in with your Figmints Google account). Create a project, e.g. `website-watch`, or pick an existing one.
2. **APIs & Services → Library**: search **PageSpeed Insights API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. On the key: **Edit API key → API restrictions → Restrict key → PageSpeed Insights API** → Save. (Then the key can't be used for anything else if it leaks.)
5. Add it as `PAGESPEED_API_KEY` in Vercel (Production, **Sensitive**) and in `.env.local`. Redeploy.

The key goes only to Google's PageSpeed service and is never stored in check results or shown in messages.

### Tracking tags

A **Tracking Tags** monitor loads a page and looks for marketing and analytics tags in its HTML. It fails when a tag you expect is gone, for example after a theme update, a plugin change or a redesign.

| Tag | Detected by | ID shown |
| --- | --- | --- |
| Google Tag Manager | `googletagmanager.com/gtm.js` or a `GTM-…` container ID | `GTM-XXXX` |
| Google Analytics 4 | the `gtag.js?id=G-…` loader or `gtag('config', 'G-…')` | `G-XXXX` |
| Google Ads | `AW-…` conversion IDs | `AW-123…` |
| Meta Pixel | `fbevents.js` or `fbq('init', …)` | pixel ID |
| LinkedIn Insight | `snap.licdn.com` insight script or `_linkedin_partner_id` | partner ID |
| HubSpot | `hs-scripts.com`, `hs-analytics.net` or `hsforms.net` | portal ID |

- **Adding one:** tick **Also watch the homepage's tracking tags** on **Add client** or **Add monitors**. The app looks at the homepage right away and **expects whatever tags are there now**. Checked every 6 hours; one per website.
- **Choosing tags:** **Edit monitor** → tick the tags that must be on the page. The monitor page lists expected tags as *Present* or *Missing* with their IDs, and also tags that are on the page but not expected.
- **Severity:** Warning by default. Set it to **Critical** for clients whose ads or reporting depend on it, so a missing tag posts to Slack.
- **Limitation:** tags that Google Tag Manager loads, such as GA4 configured *inside* a GTM container, aren't in the page's HTML and can't be seen without a real browser. For those sites, expect **Google Tag Manager** itself. Verifying tags inside GTM would need browser monitoring (Phase 6).
- **Uptime and safety:** like other page checks, it doesn't count toward uptime and uses the same SSRF protection.

### Broken link scans

A **Broken Links** monitor loads a page and checks what it links to: links, images, stylesheets and scripts.

- **Adding one:** tick **Also scan the homepage for broken links** on **Add client** or **Add monitors**. It scans the homepage daily, one scan per website. To scan another page, **Edit monitor** and change the URL, or add another monitor with type *Broken Links*.
- **How much it checks:** up to **40** links per scan, same-site links first. It sends a `HEAD` request, falling back to `GET` if the server rejects `HEAD`, with an 8-second limit per link.
- **Gentle on the client's server:** at most 2 requests at a time go to the site itself, and up to 6 at a time to other sites. A typical scan takes about 15 seconds.
- **What counts as broken:** HTTP 404, 410, 5xx, an unknown domain, a refused connection, or an SSL error.
- **What doesn't:** 401/403 (login or bot blocking), 429 (rate limiting), LinkedIn's 999, and timeouts are counted as "couldn't verify". They never raise a problem, so they don't cause false alarms.
- **Result:** any broken link makes the check a **Warning**, and 2 scans in a row open a Warning incident. That never posts to Slack.
- **Where you see it:** the monitor page lists each broken link with its status and link text. Tables show "40 links checked · 2 broken".
- **Uptime:** link scans don't count toward uptime.
- **Safety:** every request uses the same SSRF protection as page checks. Links to private addresses are skipped, not fetched.

### Vulnerabilities

A **Vulnerabilities** monitor compares a site's WordPress, plugin and theme versions with **Wordfence Intelligence**, a free list of known security flaws in WordPress software.

| Result | When |
| --- | --- |
| **Failed** (monitor severity, Critical by default, so it posts to Slack) | A vulnerability scoring **7.0 or more** (CVSS, 0–10) that an attacker can use **without logging in** |
| **Warning** | Any other known vulnerability in an installed version |
| **Passed** | None found |

Flaws that need a login (most of them need an editor or admin account) are real but rarely urgent, so they only warn. The score is changeable in **Settings → Monitoring rules**.

- **Adding one:** it's added with **Also check WordPress health** (Add client, Add monitors, Import from WP Engine), one per website. The migration adds one to every website that already has a WordPress Health monitor.
- **It never contacts the site.** It uses the plugin list from the website's latest WordPress Health check (last 7 days), so it needs a WordPress Health monitor on the same website. It runs right after each WordPress Health check and after each new vulnerability list, and daily otherwise.
- **What's checked:** with the **WordPress plugin** installed, WordPress and every plugin and theme (active or not: an inactive plugin's files can still be attacked). Without it, only WordPress and the plugins whose version is visible from outside; the monitor page says so.
- **Where you see it:** the monitor page lists each affected plugin with its vulnerabilities (linked to Wordfence), score, whether a login is needed, and the version that fixes it, or "no fix yet" (then consider removing the plugin). The weekly summary has a **Known vulnerabilities** section.
- **Incidents** are named after what's affected, e.g. "Serious vulnerability in Contact Form 7". Updating the plugin resolves it after the next WordPress Health check.

**The vulnerability list** is downloaded once a day (about 100 MB) into the `wp_vulnerabilities` table by `/api/cron/refresh-vulnerabilities`. A failed download keeps the previous list. **Settings → Vulnerabilities** shows when it was last downloaded and any error. Wordfence limits how often a key can download, so it never retries by itself; the next day's run tries again.

**Setting it up (once)**

1. Create a free account on [wordfence.com](https://www.wordfence.com) with a shared address (e.g. `websitewatch@figmints.com`), then **Account → Integrations → Generate API key**. It's shown only once; store it in a password manager.
2. Add it as `WORDFENCE_API_KEY` in Vercel (**Production** only, **Sensitive**). Redeploy.
3. Run the migration `20261010000000_vulnerabilities.sql`.
4. Run `supabase/setup/schedule-vulnerabilities.sql` in the Supabase SQL Editor (after `schedule-checks.sql`; it reuses its stored URL and secrets). The first download happens at 06:17 UTC; to get it sooner, call the endpoint once:
   ```bash
   curl -X POST https://YOUR-PRODUCTION-DOMAIN/api/cron/refresh-vulnerabilities -H "Authorization: Bearer $CRON_SECRET"
   ```

Data from [Wordfence Intelligence](https://www.wordfence.com/threat-intel/), free for commercial use with attribution (shown on each monitor page).

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
| 2 failed or slow checks in a row (changeable in **Settings**), no unresolved incident | **Incident opens**. *First detected* is the first failure in the streak. |
| Still failing with an incident | The incident's *last detected* time and description update. Severity can go up (slow → down), never down. |
| 1 success | Nothing yet. One good check isn't enough. |
| 2 successes in a row | **Incident resolves** automatically, whatever its status (Open, Investigating, Snoozed, Expected Maintenance). |

- **Severity:** a failed check uses the monitor's *severity on failure*. A slow response is at most **Warning**.
- **Titles** describe the failure, e.g. "Contact Page returning HTTP 500", "Expected content missing on Contact Page", "Homepage is unreachable".
- **Ignored** incidents stay out of the Needs attention list. While one is unresolved, continued failures don't open new incidents. When the site recovers it's closed, but keeps the *Ignored* status so the history shows nobody acted on it.
- **Only one unresolved incident per monitor.** A database index enforces this, so two checks finishing together can't open duplicates.
- **Slower monitors confirm quickly.** A monitor that runs less often than every 5 minutes (hourly, daily, weekly…) re-checks within 5 minutes after a first failure, and after a first success while an incident is open, instead of waiting a whole interval.
- **After a maintenance window ends,** an Expected Maintenance incident that's still failing becomes **Open** (and alerts, if Critical).
- **Pausing a monitor** closes its unresolved incident ("Closed because the monitor was paused"), since it won't be checked again. Changing a monitor's interval makes it due right away.
- **If a check itself breaks** (a bug or something unexpected in Website Watch), it's recorded as a Warning ("Website Watch couldn't finish this check: …") rather than retried silently.

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
2. The endpoint **claims** due monitors, 20 at a time, with the `claim_due_monitors` database function. "Due" means active monitor, website and client, with *next check* now or within the next minute. Claiming locks those monitors for 5 minutes, so overlapping or duplicate calls never check the same monitor twice.
3. It checks them 10 at a time, claiming the next batch as it runs out, up to 150 per run. Each check is saved, incident rules are applied, and *next check* is set to now + the monitor's interval. Slow checks (page speed, link scans, WordPress Health, contact forms) go first and only start early in the run.
4. After 20 s the run stops starting new checks (running ones finish; a WordPress Health check can take up to ~35 s), and the monitors it didn't get to are released right away for the next run. A bigger backlog drains over the following runs.
5. **Housekeeping:** every run reopens snoozes that have expired. Once an hour, it deletes check results older than **90 days**.

**Intervals:** 5 min, 15 min, 30 min, 1 hour, 6 hours, daily, weekly, or monthly (every 30 days), enforced by the database (migration `20261005000000_weekly_monthly_intervals.sql` added the last two). Weekly or monthly suits slow-changing checks like domain expiry, page speed or link scans. A new monitor with no *next check* is due right away. Check history is kept 90 days, so a monthly monitor keeps its last three results.

**Why Supabase and not Vercel Cron?** On Vercel's Hobby plan, cron jobs can run only once a day, and a more frequent schedule makes deployments fail. On Pro you could instead add a `crons` entry to `vercel.json` pointing at `/api/cron/run-checks` (Vercel sends `CRON_SECRET` automatically).

### Setting it up (once)

1. **Run the migration** `supabase/migrations/20260924000000_scheduler.sql` in the Supabase SQL Editor.
2. **Create a secret:** run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and copy the output.
3. **Add it to Vercel:** Project → Settings → Environment Variables → `CRON_SECRET` = that value (Production, Sensitive). Redeploy.
4. **If production uses Vercel Authentication** (Deployment Protection → *All Deployments*): Deployment Protection → **Protection Bypass for Automation** → create a secret. Scheduled calls come from Supabase, not a logged-in user, so they need it.
5. **Schedule it:** open `supabase/setup/schedule-checks.sql`, replace the three placeholders (production URL, `CRON_SECRET`, bypass secret), and run it in the Supabase SQL Editor. The values are stored encrypted in Supabase Vault. Don't commit a filled-in copy.
6. **Verify:** within 5 minutes, **Settings → Scheduled checks** should show a recent *Most recent check*, and monitors should show *Next check* times. The bottom of `schedule-checks.sql` has queries for troubleshooting (run history, HTTP responses).

### Checking many sites

A run gets through roughly 80 quick checks (more if sites answer fast, fewer with many slow check types). Every 5 minutes that's about **23,000 checks a day**; every minute, about **115,000**. A monitor every 15 minutes uses 96 a day, every 6 hours 4.

For more than ~50 sites, run the scheduler **every minute** by running this once in the Supabase SQL Editor (it only changes the schedule):

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'website-watch-run-checks'),
  schedule => '* * * * *'
);
```

Runs never overlap on the same monitor (see *claims* above), so this is safe. **Import from WP Engine** shows the expected load before you import.

**Settings → Run due checks now** runs the same worker immediately, which is useful for testing or catching up. For local development you can also call the endpoint directly:

```bash
curl -X POST http://localhost:3000/api/cron/run-checks -H "Authorization: Bearer $CRON_SECRET"
```

## Uptime history

Page-load monitors (HTTP status, expected content, response time) show a **bar for each of the last 90 days**, like public status pages: on each monitor's page, per website on the client page, and per day of the month in the monthly report. Colors: up all day, brief problems (99% or more), degraded (95% or more), down for part of the day, or no checks; hover a bar for that day's numbers. Days are counted in the database (`daily_uptime`, migration `20261007000000_daily_uptime.sql`) in `APP_TIMEZONE`, so the app doesn't load every check. History is kept 90 days.

## Monthly report

Each client has a **Monthly report** (client page → **Monthly report**): one printable page summarizing a calendar month (`APP_TIMEZONE`) to send to the client or use in account reviews. **Print / Save as PDF** hides the app around it.

- **Overview:** uptime (page-load checks), incidents opened, average time to resolve, and WordPress updates made.
- **Uptime by website**, with a bar for each day of the month, and **incidents** (what happened, severity, when, how long it took to fix).
- **WordPress maintenance**, per site: core and plugin/theme updates made during the month, backups, PHP errors, and updates still pending. Updates are worked out by comparing versions at the start and end of the month, so nobody has to log them. With the Website Watch plugin every update is listed (compared from the first check that had its full list); without it, only what's visible from outside.
- **Page speed:** latest score and the month's range and average.
- **Security and visibility:** SSL certificate and domain renewal dates, and whether search engines could index the site all month.

**Posted to Slack on the 1st:** at the weekly summary's hour (Settings → Monitoring rules), one message lists every active client with its uptime, incidents and WordPress updates for the month that just ended, and links to each report (clients needing a look first, marked :large_orange_circle:: uptime under 99.9%, backups, PHP errors, search or form problems). If the scheduler was down, it's posted within 24 hours. It's claimed in `monthly_report_posts` so it's posted once, and can be turned off in Settings. **Settings → Alerts → Post last month's reports now** posts it on demand. With many clients, up to 40 are listed, then "…and N more".

Sections without monitors are left out. **Months:** the current one ("so far") and the two before it; check history is kept 90 days. The page opens on last month, the one to send at the start of a month. It's for staff only (it needs sign-in); clients get the PDF.

## Settings

**Settings → Monitoring rules** changes how checks are judged, without a deploy. Values are stored in one row of the `app_settings` table (migration `20261002000000_app_settings.sql`), and checks pick up a change within about 30 seconds. The page shows who changed them last.

| Setting | Default | Allowed |
| --- | --- | --- |
| Failed checks before an incident opens | 2 | 1–10 |
| Passing checks before it resolves | 2 | 1–10 |
| Default response time limit (for Response Time monitors without their own) | 3000 ms | 500–30000 |
| SSL: Warning when it expires within | 14 days | 1–90 |
| SSL: Failed when it expires within | 3 days | 0–60, fewer than the warning |
| WordPress: backup missing after | 48 hours | 12–720 |
| WordPress: minimum PHP version | 8.2 | e.g. 7.4, or empty to not check PHP |
| WordPress: available updates count as a Warning | on | Off keeps updates listed (monitor page, weekly summary) without turning sites yellow |
| Page speed: warn below this performance score | 50 | 0–100 (0 turns the score warning off) |
| Weekly summary on, day, time | on, Monday, 9:00 | any day, any hour (`APP_TIMEZONE`) |

The database enforces the same limits, and the app falls back to the defaults if the row is missing (e.g. before the migration runs). Changes apply to new checks; existing incidents and past results aren't re-judged. Everything else (connections, secrets, timezone) stays in environment variables.

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
- **A failed alert is retried** on the incident's next change, or on its next failed check if it was never sent.

### Weekly summary

Every **Monday at 9:00** (`APP_TIMEZONE`; day, time and on/off in **Settings**), one Slack message to the same channel lists what needs work across all active sites, so update warnings become a to-do list instead of a wall of yellow badges:

- **Overview:** websites, uptime over 7 days, incidents opened this week and still open.
- **Needs attention now:** unresolved incidents, Critical first. Warnings that have their own section below aren't repeated.
- **Known vulnerabilities:** per site, the affected plugins with the version that fixes them; serious ones (no login needed) first and in bold.
- **Backups:** WordPress Health backup problems.
- **SSL certificates** expiring within 30 days.
- **WordPress updates:** per site, core behind, plugin updates (with names; premium ones too when the site plugin is installed) and theme updates. Sites with the most updates first.
- **Broken links** and **missing tracking tags**.
- A week with nothing to report gets a short "All clear".

Each section lists up to 15 sites, then "…and N more". Staging sites are marked.

**How it's sent:** the scheduler checks on every run whether this week's summary is due. The first run after the scheduled time claims the week in the `weekly_summaries` table and posts it; if the scheduler was down, it goes out as soon as it's back, within 24 hours of the scheduled time. (Changing the day in Settings to one that already passed this week doesn't send an extra summary.) The claim makes sure it's posted once, even with overlapping runs. If Slack fails, the claim is released and the next run tries again.

- **Settings → Alerts → Send summary now** posts the current summary right away, e.g. to preview it. It doesn't affect the scheduled send.
- **Setup:** run the migration `20261001000000_weekly_summary.sql`. Nothing else: it uses `SLACK_WEBHOOK_URL` and the existing scheduler.
- **The first summary** goes out at the first scheduled time after the migration and deploy (or within 24 hours after it).

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
- The WordPress plugin's private key stays server-side; sites hold only the public key. Each request is signed for one site's HTTPS address, a 5-minute window and one use, sent only over HTTPS, and redirects aren't followed.
- WP Engine credentials are used server-side only, for read-only calls to the fixed `api.wpengineapi.com` host.
- The Wordfence API key is used server-side only, for one daily download from the fixed `www.wordfence.com` feed URL. Vulnerability checks never contact the client's site.
- Alerts are only posted to a `hooks.slack.com` webhook from `SLACK_WEBHOOK_URL`. Client names, titles and errors are escaped before they go into Slack formatting.
- `claim_due_monitors` can only be called with the secret key; execution is revoked from the public `anon` and `authenticated` roles.
