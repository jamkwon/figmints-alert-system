"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NEXT_PATH_COOKIE, safeNextPath } from "@/lib/auth/allowed";
import { allowedDomains, createAuthClient, getAuthMode } from "@/lib/auth/session";

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
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
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await requestOrigin()}/auth/callback`,
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
