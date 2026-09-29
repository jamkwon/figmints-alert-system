"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NEXT_PATH_COOKIE, safeNextPath, trustedOrigin } from "@/lib/auth/allowed";
import { appUrl } from "@/lib/notify/send";
import { allowedDomains, createAuthClient, getAuthMode } from "@/lib/auth/session";

/**
 * Where Google should send people back: this request's origin if it's one of the
 * app's own addresses (so previews and localhost work), otherwise APP_URL.
 * Supabase's Redirect URLs allow list is the main guard; this is a second one.
 */
async function returnOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = h.get("origin") ?? (host ? `${proto}://${host}` : null);
  return trustedOrigin(
    origin,
    [appUrl(), process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL],
    appUrl(),
  );
}

/** Starts Google sign-in. Supabase only redirects back to URLs on its allow list. */
export async function signInWithGoogle(formData: FormData) {
  if (getAuthMode() !== "required") redirect("/login?error=config");
  // Where to go after sign-in. Kept in a short-lived cookie rather than the return
  // URL, so the return URL exactly matches Supabase's Redirect URLs allow list.
  (await cookies()).set(NEXT_PATH_COOKIE, safeNextPath(formData.get("next")), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth",
    maxAge: 600,
  });
  const origin = await returnOrigin();
  if (!origin) redirect("/login?error=config");
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      // hd pre-selects the Figmints Google Workspace. It's only a hint; the domain
      // is enforced after sign-in (auth/callback, proxy, requireStaff).
      queryParams: { hd: allowedDomains()[0], prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  if (getAuthMode() === "required") {
    const supabase = await createAuthClient();
    await supabase.auth.signOut();
  }
  redirect("/login?signed_out=1");
}
