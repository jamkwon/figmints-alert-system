// "Website Watch Health": a read-only WordPress plugin. It reports the
// versions and available updates WordPress already knows about (including
// premium plugins that use WordPress's update system), so the WordPress Health
// check can see what isn't visible from outside.
//
// Requests are signed with an Ed25519 private key that never leaves Website
// Watch. The plugin holds only the public key, so the file contains no secret.
// Each signature covers the site's host and the current time, and the plugin
// accepts it once, so a captured or redirected request is useless elsewhere,
// later, or a second time.
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { firstSetEnv } from "../supabase/config.ts";
import { zipFiles } from "./zip.ts";

export const WP_PLUGIN_VERSION = "1.3.0";
/** Folder and main file name inside the zip, and the plugin's slug. */
export const WP_PLUGIN_SLUG = "website-watch-health";
export const WP_PLUGIN_ZIP = `${WP_PLUGIN_SLUG}.zip`;
/** Works with or without pretty permalinks. */
export const WP_PLUGIN_ROUTE = "/?rest_route=/website-watch/v1/status";
export const SIGNATURE_HEADER = "x-website-watch-signature";
export const TIMESTAMP_HEADER = "x-website-watch-timestamp";
/** How far the plugin accepts a signature's time from its own clock. */
export const SIGNATURE_MAX_AGE_SECONDS = 300;

// DER prefix that turns a raw 32-byte Ed25519 seed into a PKCS#8 private key.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * The signing key (64 hex characters, a 32-byte seed) from WEBSITE_WATCH_PLUGIN_KEY,
 * or WEBSITE_WATCH_PLUGIN_TOKEN, its earlier name.
 */
export function pluginKey(): KeyObject | null {
  const raw = firstSetEnv(["WEBSITE_WATCH_PLUGIN_KEY", "WEBSITE_WATCH_PLUGIN_TOKEN"])?.value?.trim();
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) return null;
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(raw, "hex")]),
    format: "der",
    type: "pkcs8",
  });
}

/** The raw 32-byte public key, base64, as the plugin expects it. Not secret. */
export function publicKeyBase64(key: KeyObject): string {
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return spki.subarray(spki.length - 32).toString("base64");
}

/** What gets signed: a fixed label, the site's host and the time. */
export function signedMessage(host: string, timestamp: number): string {
  return `website-watch-health/v1\n${host.toLowerCase()}\n${timestamp}`;
}

/** Headers for one request to the plugin on `host`. */
export function signRequest(key: KeyObject, host: string, now = Date.now()): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: sign(null, Buffer.from(signedMessage(host, timestamp)), key).toString("base64"),
  };
}

/** Only plain addresses: this goes into a PHP string. */
const TEST_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Where plugins send a daily test email, from WEBSITE_WATCH_TEST_EMAIL; null turns it off. */
export function pluginTestEmail(): string | null {
  const email = firstSetEnv(["WEBSITE_WATCH_TEST_EMAIL"])?.value?.trim();
  return email && TEST_EMAIL.test(email) ? email : null;
}

/** The zip WordPress's "Upload Plugin" screen expects: website-watch-health/website-watch-health.php. */
export function pluginZip(publicKey: string, testEmail: string | null = null, date = new Date()): Buffer {
  const file = { name: `${WP_PLUGIN_SLUG}/${WP_PLUGIN_SLUG}.php`, data: Buffer.from(pluginSource(publicKey, testEmail)) };
  return zipFiles([file], date);
}

/** The plugin file, with the public key (and the daily test email's address, if any) filled in. */
export function pluginSource(publicKey: string, testEmail: string | null = null): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) throw new Error("Invalid public key");
  if (testEmail !== null && !TEST_EMAIL.test(testEmail)) throw new Error("Invalid test email address");
  return PLUGIN_TEMPLATE.replace("__PUBLIC_KEY__", publicKey)
    .replace("__TEST_EMAIL__", testEmail ?? "")
    .replaceAll("__VERSION__", WP_PLUGIN_VERSION)
    .replaceAll("__MAX_AGE__", String(SIGNATURE_MAX_AGE_SECONDS));
}

const PLUGIN_TEMPLATE = `<?php
/**
 * Plugin Name: Website Watch Health
 * Description: Health report for Figmints Website Watch: WordPress, PHP, plugin and theme versions and updates, PHP errors, and whether the site can send email. It never changes your content or settings.
 * Version: __VERSION__
 * Author: Figmints
 * Requires at least: 5.8
 * Requires PHP: 7.2
 * Update URI: false
 *
 * "Update URI: false" stops WordPress from ever replacing this plugin with a
 * wordpress.org plugin that happens to use the same folder name.
 *
 * Install from Plugins → Add New Plugin → Upload Plugin, then Activate. It
 * adds one endpoint, POST /wp-json/website-watch/v1/status, which answers only requests signed by
 * Website Watch for this site within the last few minutes, each one only once.
 *
 * Security notes:
 * - No secrets here: WEBSITE_WATCH_PUBLIC_KEY is a public Ed25519 key. The
 *   private key that signs requests never leaves Website Watch.
 * - Reads only what WordPress's own update checks already stored. It never
 *   updates, installs or changes anything, never calls out, and takes no input
 *   besides the signature headers. It records fatal PHP errors and failed
 *   emails (last 7 days, reasons only), and sends a daily test email when
 *   WEBSITE_WATCH_TEST_EMAIL is set.
 */

if (!defined('ABSPATH')) {
	exit;
}

// Loaded twice (two copies installed, e.g. in different folders)? Only the first copy
// runs. Everything sits inside this block because PHP declares a file's
// top-level functions before running it: an early return would still end in a
// fatal "cannot redeclare" error and take the site down.
if (!defined('WEBSITE_WATCH_HEALTH_VERSION')) {
	define('WEBSITE_WATCH_HEALTH_VERSION', '__VERSION__');
	define('WEBSITE_WATCH_PUBLIC_KEY', '__PUBLIC_KEY__');
	define('WEBSITE_WATCH_MAX_AGE', __MAX_AGE__);

	add_action('rest_api_init', function () {
		register_rest_route('website-watch/v1', '/status', array(
			// POST, so page caches (including WP Engine's) never store a response.
			'methods'             => 'POST',
			'callback'            => 'website_watch_health_report',
			'permission_callback' => 'website_watch_health_allowed',
			'show_in_index'       => false,
			'args'                => array(),
		));
	});

	// Don't advertise the plugin: drop its namespace (and the namespace page
	// WordPress adds automatically) from the public REST index.
	add_filter('rest_endpoints', function ($endpoints) {
		unset($endpoints['/website-watch/v1']);
		return $endpoints;
	});
	add_filter('rest_index', function ($response) {
		$data = $response->get_data();
		if (isset($data['namespaces']) && is_array($data['namespaces'])) {
			$data['namespaces'] = array_values(array_diff($data['namespaces'], array('website-watch/v1')));
			$response->set_data($data);
		}
		return $response;
	});

	/** This site's own hosts, from its settings (never from the request). */
	function website_watch_health_hosts() {
		$hosts = array();
		foreach (array(home_url(), site_url()) as $url) {
			$host = strtolower((string) wp_parse_url($url, PHP_URL_HOST));
			if ($host === '') {
				continue;
			}
			$bare = preg_replace('/^www\\\\./', '', $host);
			$hosts[] = $bare;
			$hosts[] = 'www.' . $bare;
		}
		return array_values(array_unique($hosts));
	}

	function website_watch_health_allowed($request) {
		$key = base64_decode(WEBSITE_WATCH_PUBLIC_KEY, true);
		$signature = base64_decode((string) $request->get_header('x-website-watch-signature'), true);
		$timestamp = (string) $request->get_header('x-website-watch-timestamp');
		if ($key === false || strlen($key) !== 32 || $signature === false || strlen($signature) !== 64) {
			return false;
		}
		if (!preg_match('/^[0-9]{9,11}$/', $timestamp) || abs(time() - (int) $timestamp) > WEBSITE_WATCH_MAX_AGE) {
			return false;
		}
		// Built into PHP 7.2+; WordPress also bundles a fallback (sodium_compat).
		if (!function_exists('sodium_crypto_sign_verify_detached')) {
			return false;
		}
		foreach (website_watch_health_hosts() as $host) {
			$message = "website-watch-health/v1\\n" . $host . "\\n" . $timestamp;
			try {
				$valid = sodium_crypto_sign_verify_detached($signature, $message, $key);
			} catch (Throwable $e) {
				return false;
			}
			if ($valid) {
				return website_watch_health_first_use($signature);
			}
		}
		return false;
	}

	/** Each signature works once: a captured request can't be replayed. */
	function website_watch_health_first_use($signature) {
		$seen = 'website_watch_sig_' . md5($signature);
		if (get_site_transient($seen)) {
			return false;
		}
		set_site_transient($seen, 1, 2 * WEBSITE_WATCH_MAX_AGE);
		return true;
	}

	function website_watch_health_time($timestamp) {
		return $timestamp ? gmdate('c', (int) $timestamp) : null;
	}

	// Fatal PHP errors ---------------------------------------------------------------
	// WordPress keeps no log of fatal errors, so the plugin records them itself:
	// the last 7 days, at most 20 distinct errors, in one non-autoloaded option.
	// WordPress shows its "critical error" page from its own shutdown handler and
	// then stops PHP, so shutdown functions registered later never run. Record the
	// error from the wp_php_error_message filter it applies just before that page,
	// and from our own shutdown function when it doesn't show the page (output had
	// already started, or its handler is disabled).
	define('WEBSITE_WATCH_FATAL_OPTION', 'website_watch_health_fatal_errors');

	add_filter('wp_php_error_message', function ($message, $error) {
		website_watch_health_record_fatal($error);
		return $message;
	}, 10, 2);

	register_shutdown_function(function () {
		website_watch_health_record_fatal(error_get_last());
	});

	register_deactivation_hook(__FILE__, function () {
		delete_option(WEBSITE_WATCH_FATAL_OPTION);
		delete_option(WEBSITE_WATCH_MAIL_OPTION);
		wp_clear_scheduled_hook('website_watch_health_test_email');
	});

	/** Paths relative to the site ("wp-content/plugins/x/y.php"), so server paths aren't stored. */
	function website_watch_health_relative_path($path) {
		$path = wp_normalize_path((string) $path);
		$content = defined('WP_CONTENT_DIR') ? rtrim(wp_normalize_path(WP_CONTENT_DIR), '/') : '';
		$root = rtrim(wp_normalize_path(ABSPATH), '/');
		if ($content !== '' && strpos($path, $content . '/') === 0) {
			return 'wp-content' . substr($path, strlen($content));
		}
		if ($root !== '' && strpos($path, $root . '/') === 0) {
			return substr($path, strlen($root) + 1);
		}
		return basename($path);
	}

	/** First line only (no stack traces, which can hold arguments), server paths removed, at most 300 characters. */
	function website_watch_health_clean_message($message) {
		$lines = preg_split('/\\r\\n|\\r|\\n/', (string) $message);
		$message = trim((string) $lines[0]);
		$bases = array(rtrim(ABSPATH, '/'));
		if (defined('WP_CONTENT_DIR')) {
			array_unshift($bases, WP_CONTENT_DIR);
		}
		$message = str_replace($bases, defined('WP_CONTENT_DIR') ? array('wp-content', '') : array(''), $message);
		return function_exists('mb_substr') ? mb_substr($message, 0, 300) : substr($message, 0, 300);
	}

	function website_watch_health_record_fatal($error) {
		static $recorded = false;
		$fatal = array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR);
		if ($recorded || !is_array($error) || !isset($error['type']) || !in_array($error['type'], $fatal, true)) {
			return;
		}
		if (!function_exists('get_option') || !function_exists('update_option')) {
			return;
		}
		$recorded = true;
		try {
			$now = time();
			$log = get_option(WEBSITE_WATCH_FATAL_OPTION, array());
			if (!is_array($log)) {
				$log = array();
			}
			// At most one write every 10 seconds, so a flood of errors can't flood the database.
			if (isset($log['written_at']) && $now - (int) $log['written_at'] < 10) {
				return;
			}
			$file = website_watch_health_relative_path(isset($error['file']) ? $error['file'] : '');
			$line = isset($error['line']) ? (int) $error['line'] : 0;
			$message = website_watch_health_clean_message(isset($error['message']) ? $error['message'] : '');
			$key = md5($error['type'] . '|' . $file . '|' . $line . '|' . $message);
			$errors = isset($log['errors']) && is_array($log['errors']) ? $log['errors'] : array();
			foreach ($errors as $id => $entry) {
				if (!is_array($entry) || !isset($entry['last']) || $now - (int) $entry['last'] > 7 * DAY_IN_SECONDS) {
					unset($errors[$id]);
				}
			}
			if (isset($errors[$key])) {
				$errors[$key]['count'] = (int) $errors[$key]['count'] + 1;
				$errors[$key]['last'] = $now;
			} else {
				$errors[$key] = array(
					'first'   => $now,
					'last'    => $now,
					'count'   => 1,
					'type'    => (int) $error['type'],
					'message' => $message,
					'file'    => $file,
					'line'    => $line,
				);
			}
			uasort($errors, function ($a, $b) {
				return (int) $b['last'] - (int) $a['last'];
			});
			update_option(WEBSITE_WATCH_FATAL_OPTION, array('written_at' => $now, 'errors' => array_slice($errors, 0, 20, true)), false);
		} catch (Throwable $e) {
			// Never make a failing request worse.
		}
	}

	// Email ---------------------------------------------------------------------------
	// Form notifications go through wp_mail whichever form plugin sends them, so
	// record emails that fail (last 7 days, the reason only: no addresses or
	// content), when one last went out, and the daily test email's result when
	// WEBSITE_WATCH_TEST_EMAIL is set. One non-autoloaded option.
	define('WEBSITE_WATCH_MAIL_OPTION', 'website_watch_health_mail');
	define('WEBSITE_WATCH_TEST_EMAIL', '__TEST_EMAIL__');

	/** Reads, changes and saves the email log; $change returns null to skip the write. */
	function website_watch_health_update_mail($change) {
		try {
			$log = get_option(WEBSITE_WATCH_MAIL_OPTION, array());
			if (!is_array($log)) {
				$log = array();
			}
			$next = $change($log, time());
			if (is_array($next)) {
				update_option(WEBSITE_WATCH_MAIL_OPTION, $next, false);
			}
		} catch (Throwable $e) {
			// Never break sending email.
		}
	}

	/** The reason only: first line, addresses masked, at most 300 characters. */
	function website_watch_health_mail_reason($message) {
		$lines = preg_split('/\\r\\n|\\r|\\n/', (string) $message);
		$reason = trim((string) preg_replace('/[[:alnum:]._%+-]+@[[:alnum:].-]+/', '[address]', (string) $lines[0]));
		$reason = function_exists('mb_substr') ? mb_substr($reason, 0, 300) : substr($reason, 0, 300);
		return $reason === '' ? 'Unknown error' : $reason;
	}

	add_action('wp_mail_failed', function ($error) {
		$reason = website_watch_health_mail_reason(is_wp_error($error) ? $error->get_error_message() : '');
		website_watch_health_update_mail(function ($log, $now) use ($reason) {
			// At most one write every 10 seconds, so a burst of failures can't flood the database.
			if (isset($log['failure_written']) && $now - (int) $log['failure_written'] < 10) {
				return null;
			}
			$failures = isset($log['failures']) && is_array($log['failures']) ? $log['failures'] : array();
			foreach ($failures as $key => $failure) {
				if (!is_array($failure) || !isset($failure['last']) || $now - (int) $failure['last'] > 7 * DAY_IN_SECONDS) {
					unset($failures[$key]);
				}
			}
			$key = md5($reason);
			if (isset($failures[$key])) {
				$failures[$key]['count'] = (int) $failures[$key]['count'] + 1;
				$failures[$key]['last'] = $now;
			} else {
				$failures[$key] = array('first' => $now, 'last' => $now, 'count' => 1, 'message' => $reason);
			}
			uasort($failures, function ($a, $b) {
				return (int) $b['last'] - (int) $a['last'];
			});
			$log['failures'] = array_slice($failures, 0, 20, true);
			$log['failure_written'] = $now;
			return $log;
		});
	});

	// WordPress 5.9+ says when an email went out.
	add_action('wp_mail_succeeded', function () {
		website_watch_health_update_mail(function ($log, $now) {
			// This runs for every email the site sends: write at most every 10 minutes.
			if (isset($log['last_sent']) && $now - (int) $log['last_sent'] < 600) {
				return null;
			}
			$log['last_sent'] = $now;
			return $log;
		});
	});

	// A daily test email proves email works even on days nobody submits a form.
	add_action('init', function () {
		if (is_email(WEBSITE_WATCH_TEST_EMAIL) && !wp_next_scheduled('website_watch_health_test_email')) {
			wp_schedule_event(time() + 300, 'daily', 'website_watch_health_test_email');
		}
	});
	add_action('website_watch_health_test_email', 'website_watch_health_send_test_email');

	function website_watch_health_send_test_email() {
		if (!is_email(WEBSITE_WATCH_TEST_EMAIL)) {
			return;
		}
		$error = null;
		$capture = function ($e) use (&$error) {
			$error = website_watch_health_mail_reason(is_wp_error($e) ? $e->get_error_message() : '');
		};
		add_action('wp_mail_failed', $capture);
		$site = (string) wp_parse_url(home_url(), PHP_URL_HOST);
		$sent = wp_mail(
			WEBSITE_WATCH_TEST_EMAIL,
			'Website Watch test email: ' . $site,
			'This automated email checks that ' . home_url('/') . ' can send email, such as form notifications. The Website Watch Health plugin sends it once a day; no action is needed.'
		);
		remove_action('wp_mail_failed', $capture);
		website_watch_health_update_mail(function ($log, $now) use ($sent, $error) {
			$log['test'] = array('at' => $now, 'ok' => (bool) $sent, 'error' => $sent ? null : ($error ? $error : 'wp_mail returned false'));
			return $log;
		});
	}

	function website_watch_health_mail_report() {
		$log = get_option(WEBSITE_WATCH_MAIL_OPTION, array());
		if (!is_array($log)) {
			$log = array();
		}
		$failures = array();
		foreach (isset($log['failures']) && is_array($log['failures']) ? $log['failures'] : array() as $failure) {
			if (!is_array($failure)) {
				continue;
			}
			$failures[] = array(
				'last_at' => website_watch_health_time(isset($failure['last']) ? $failure['last'] : 0),
				'count'   => isset($failure['count']) ? (int) $failure['count'] : 1,
				'message' => isset($failure['message']) ? (string) $failure['message'] : '',
			);
		}
		$test = isset($log['test']) && is_array($log['test']) ? $log['test'] : array();
		return array(
			'failures'     => $failures,
			'last_sent_at' => website_watch_health_time(isset($log['last_sent']) ? $log['last_sent'] : 0),
			'test'         => array(
				'configured' => (bool) is_email(WEBSITE_WATCH_TEST_EMAIL),
				'last_at'    => website_watch_health_time(isset($test['at']) ? $test['at'] : 0),
				'ok'         => isset($test['ok']) ? (bool) $test['ok'] : null,
				'error'      => isset($test['error']) ? (string) $test['error'] : null,
			),
		);
	}

	function website_watch_health_fatal_errors() {
		$log = get_option(WEBSITE_WATCH_FATAL_OPTION, array());
		$errors = array();
		if (is_array($log) && isset($log['errors']) && is_array($log['errors'])) {
			foreach ($log['errors'] as $entry) {
				if (!is_array($entry)) {
					continue;
				}
				$errors[] = array(
					'first_at' => website_watch_health_time(isset($entry['first']) ? $entry['first'] : 0),
					'last_at'  => website_watch_health_time(isset($entry['last']) ? $entry['last'] : 0),
					'count'    => isset($entry['count']) ? (int) $entry['count'] : 1,
					'type'     => isset($entry['type']) ? (int) $entry['type'] : 0,
					'message'  => isset($entry['message']) ? (string) $entry['message'] : '',
					'file'     => isset($entry['file']) ? (string) $entry['file'] : '',
					'line'     => isset($entry['line']) ? (int) $entry['line'] : 0,
				);
			}
		}
		return $errors;
	}

	function website_watch_health_report() {
		if (!function_exists('get_plugins')) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		nocache_headers();

		// Only reads what WordPress's own update checks have stored; never triggers them.
		$core = get_site_transient('update_core');
		$core_update = null;
		if (is_object($core) && !empty($core->updates) && is_array($core->updates)) {
			foreach ($core->updates as $offer) {
				if (isset($offer->response, $offer->current) && $offer->response === 'upgrade') {
					$core_update = (string) $offer->current;
					break;
				}
			}
		}

		$plugin_updates = get_site_transient('update_plugins');
		$plugins = array();
		foreach (get_plugins() as $file => $data) {
			$plugins[] = array(
				'file'    => (string) $file,
				'name'    => (string) $data['Name'],
				'version' => (string) $data['Version'],
				'active'  => is_plugin_active($file),
				'update'  => isset($plugin_updates->response[$file]->new_version) ? (string) $plugin_updates->response[$file]->new_version : null,
			);
		}

		$theme_updates = get_site_transient('update_themes');
		$stylesheet = get_stylesheet();
		$template = get_template();
		$themes = array();
		foreach (wp_get_themes() as $slug => $theme) {
			$themes[] = array(
				'slug'    => (string) $slug,
				'name'    => (string) $theme->get('Name'),
				'version' => (string) $theme->get('Version'),
				'active'  => $slug === $stylesheet || $slug === $template,
				'update'  => isset($theme_updates->response[$slug]['new_version']) ? (string) $theme_updates->response[$slug]['new_version'] : null,
			);
		}

		// Minutes the oldest scheduled WP-Cron event is overdue: WordPress's update
		// checks (and scheduled posts) rely on WP-Cron running.
		$overdue = null;
		if (function_exists('_get_cron_array')) {
			$cron = _get_cron_array();
			if (is_array($cron) && !empty($cron)) {
				$overdue = max(0, (int) floor((time() - (int) min(array_keys($cron))) / 60));
			}
		}

		return array(
			'plugin_version'     => WEBSITE_WATCH_HEALTH_VERSION,
			'generated_at'       => gmdate('c'),
			'multisite'          => is_multisite(),
			'wordpress'          => array(
				'version'    => (string) get_bloginfo('version'),
				'update'     => $core_update,
				'checked_at' => website_watch_health_time(is_object($core) && isset($core->last_checked) ? $core->last_checked : 0),
			),
			'php'                => array(
				'version'      => PHP_VERSION,
				'memory_limit' => (string) ini_get('memory_limit'),
			),
			'debug_display'      => defined('WP_DEBUG') && WP_DEBUG && defined('WP_DEBUG_DISPLAY') && WP_DEBUG_DISPLAY,
			'cron'               => array(
				'disabled'        => defined('DISABLE_WP_CRON') && DISABLE_WP_CRON,
				'overdue_minutes' => $overdue,
			),
			'plugins'            => $plugins,
			'plugins_checked_at' => website_watch_health_time(is_object($plugin_updates) && isset($plugin_updates->last_checked) ? $plugin_updates->last_checked : 0),
			'themes'             => $themes,
			'fatal_errors'       => website_watch_health_fatal_errors(),
			// When WordPress last emailed the admin about a fatal error (at most daily).
			'recovery_email_at'  => website_watch_health_time((int) get_option('recovery_mode_email_last_sent', 0)),
			'mail'               => website_watch_health_mail_report(),
		);
	}
}
`;
