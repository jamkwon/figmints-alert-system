import { isStaffRequest } from "@/lib/auth/session";
import { WP_PLUGIN_ZIP, pluginKey, pluginTestEmail, pluginZip, publicKeyBase64 } from "@/lib/monitoring/wp-plugin";

// Downloads the Website Watch Health plugin as a zip for WordPress's "Upload
// Plugin" screen, with this deployment's public key filled in
// (Settings → WordPress plugin). Staff only.
export async function GET(): Promise<Response> {
  if (!(await isStaffRequest())) return new Response("Sign in first.", { status: 401 });
  const key = pluginKey();
  if (!key) return new Response("Set WEBSITE_WATCH_PLUGIN_KEY first (see README → WordPress plugin).", { status: 503 });
  return new Response(new Uint8Array(pluginZip(publicKeyBase64(key), pluginTestEmail())), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${WP_PLUGIN_ZIP}"`,
      "cache-control": "no-store",
    },
  });
}
