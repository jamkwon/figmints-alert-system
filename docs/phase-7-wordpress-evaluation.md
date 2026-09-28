# Phase 7 evaluation: WordPress and WP Engine monitoring

**Goal:** find the simplest reliable way to see, for each client site: WordPress version, plugins and themes, available updates, environment details, and WP Engine status and backups. Build no plugin unless there's a clear reason.

**Method:** a live probe of figmints.com (anonymous, read-only requests), the public WordPress.org APIs, and the WP Engine Hosting Platform API's official OpenAPI spec (`https://api.wpengineapi.com/v1/swagger`). Researched 2026-09-24.

---

## Summary

| Source | Setup per client site | What it gives | Main limit |
|---|---|---|---|
| **1. WP Engine API** | **None** (one account-level API login) | WordPress version, PHP version, environments, install status, **backups with status and timestamps**, SSL certificates, disk usage | Only sites hosted on WP Engine; no plugin list |
| **2. Public signals** | None | WP version (usually), theme, *some* plugins and versions, hosting | Best-effort; varies per site; incomplete plugin list |
| **3. WordPress.org API** | None | Latest WordPress and latest version of free plugins | Knows nothing about premium plugins (Gravity Forms, ACF Pro, Events Calendar Pro…) |
| **4. WP REST API with Application Passwords** | An **administrator** login stored per site | Full plugin and theme list with versions and active status | Needs admin credentials for every client site; no update info for premium plugins |
| **5. Small read-only plugin** | Install a must-use plugin per site | Everything above, **including premium plugin updates**, PHP details, cron health, recent fatal errors | A plugin to build, deploy and maintain |

**Recommendation:** start with **1 + 2 + 3** (Stage A). That needs no client-site changes and no per-site credentials. Consider **5** (Stage B) only if the team needs premium-plugin update tracking or PHP error monitoring after using Stage A. Avoid **4**.

---

## 1. WP Engine Hosting Platform API

- **Base URL:** `https://api.wpengineapi.com/v1`. HTTP Basic auth with API credentials from **my.wpengine.com → API Access**. Credentials inherit that user's permissions, and removing the user revokes access.
- **Relevant endpoints** (from the spec, 47 paths in total):
  - `GET /installs`, `GET /installs/{id}`: the **Installation** object has `name`, `environment` (production/staging/development), `status` (active/pending), `php_version`, **`wp_version`**, `primary_domain`, `cname`, `is_multisite`, `defer_wordpress_upgrades_until`, `site`, `account`.
  - `GET /installs/{id}/backups`, `GET /installs/{id}/backups/{backup_id}`: each **Backup** has `status` (requested/in_progress/**completed**/**aborted**), `create_time`, `complete_time`, `wordpress_version`, `description`.
  - `GET /installs/{id}/ssl_certificates`, `GET /accounts/{id}/usage`, `GET /installs/{id}/usage`.
  - `GET /status`: API health. The probe returned `{"success":true}`, and unauthenticated calls return `401 Bad Credentials` as expected.
- **Rate limits:** per account or per IP, returning `429`. A daily sync makes 1 call to list installs plus 1 backups call per install, far below any limit.
- **Cost:** included with WP Engine hosting.

**What this enables with zero client-site changes:**
- WordPress core behind the latest release: compare `wp_version` with WordPress.org's latest.
- PHP version below the supported minimum.
- **No completed backup in the last N hours, or a recent backup `aborted`.** None of the current checks can see this.
- Staging and development environments discovered automatically and linked to each client's websites.
- `defer_wordpress_upgrades_until` shows when core updates are deliberately paused.

## 2. Public signals (probe of figmints.com)

| Signal | Result on figmints.com |
|---|---|
| RSS feed `<generator>` | **WordPress 7.0.5**. WordPress.org says the latest is **7.1.2**, so core is behind |
| `?ver=` on `wp-includes` assets | also 7.0.5 |
| REST index `/wp-json/` namespaces | Yoast SEO, Redirection, Akismet, The Events Calendar (+Pro), Duplicate Post, WP Engine cache and sign-on plugins, Liquid Web Harbor |
| Plugin asset URLs | Gravity Forms 2.10.2, Events Calendar Pro 7.7.12 (only plugins that load assets on that page) |
| Theme path | `figpress` / `figpress-child` |
| Response headers | `X-Powered-By: WP Engine` |
| `readme.html` | blocked (403), good hardening |
| `/wp-json/wp/v2/plugins`, Site Health | `401` without login, as expected |

**Useful but unreliable as a source of truth.** Many sites hide the version, security plugins can block `/wp-json/`, and only plugins that load front-end assets show up. Good for a "possibly outdated" hint and for non-WP-Engine sites.

## 3. WordPress.org API (free, public)

- Latest core: `api.wordpress.org/core/version-check/1.7/` → **7.1.2**.
- Plugin info: `api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=…`, e.g. Yoast 28.5, Redirection 5.10.1, The Events Calendar 6.17.5.1, Akismet 5.7.2.
- **Premium plugins aren't there.** Gravity Forms: "Plugin not found". Agency sites rely heavily on premium plugins, so this can't give a complete "updates available" picture.

## 4. WP REST API with Application Passwords (not recommended)

- `/wp-json/wp/v2/plugins` and `/themes` list everything with versions and active status, but **require an administrator-level user** (the `activate_plugins` capability).
- That means storing **admin credentials for every client site** in one database, a high-value target if the app were ever compromised.
- It still gives **no update availability** for premium plugins. Security plugins also sometimes disable Application Passwords or the REST API.

## 5. Small read-only plugin (possible Stage B)

A must-use plugin, "Website Watch Health", could expose one read-only endpoint (`/wp-json/website-watch/v1/health`), protected by a per-site shared secret rather than admin credentials. It would return:
- core, plugin and theme versions, and **available updates, including premium plugins** (read from WordPress's own update checks);
- PHP version and memory limit, and whether WP-Cron is running;
- **recent PHP fatal errors** (from WordPress recovery mode / error log), whether debug mode is on, and database health.

**Clear reasons it might be justified later:**
1. It's the only way to track premium plugin updates.
2. It avoids storing admin credentials.
3. Fatal errors and cron health can't be seen from outside.

**Costs:** building it, deploying it to every site (WP Engine git/SFTP or a mu-plugin rollout), and keeping it compatible with future WordPress versions. That's why it's Stage B, not the starting point.

---

## Recommended plan

### Stage A: build first
1. **WP Engine connection:** one set of API credentials (`WPENGINE_API_USER`, `WPENGINE_API_PASSWORD`, server-only, sensitive).
2. **Daily sync:** list installs and match them to websites by domain (unmatched installs are shown for manual linking). Store WordPress/PHP versions, environment and status, and the latest backups.
3. **New "WordPress Health" monitor** per website, checked daily:
   - **Critical:** no completed backup in 48 hours (the threshold is adjustable), or the latest backup was aborted.
   - **Warning:** WordPress core more than one minor release behind for 14+ days (unless deliberately deferred); PHP below WordPress's recommended version; install not active.
   - **Info on the page:** versions, environments, last backup time, and visible plugins with "possibly outdated" hints.
4. **Non-WP-Engine WordPress sites:** public signals only (core version and visible plugins).

**It needs from Figmints:**
- **API Access enabled** on the WP Engine account, and an API user. Ideally a dedicated user with the least access needed.
- **Confirmation that client sites live in one WP Engine account, or which accounts.** Some clients may own their own accounts, which would need separate credentials.

### Stage B: only if needed after Stage A
The read-only mu-plugin, for premium-plugin updates, fatal errors and cron health.

### Not recommended
Storing admin Application Passwords for every client site.

---

## Open questions for Figmints

1. Are all client sites on **one** WP Engine account? If not, how many accounts, and who owns them?
2. Can someone enable **API Access** and create an API user for Website Watch?
3. For backups: what should count as "too old"? 24 hours, 48 hours, or longer?
4. Are premium-plugin updates important enough to consider Stage B later?
