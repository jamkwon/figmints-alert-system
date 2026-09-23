import { NextResponse, type NextRequest } from "next/server";
import { NEXT_PATH_COOKIE, isStaff, safeNextPath, type StaffClaims } from "@/lib/auth/allowed";
import { allowedDomains, createAuthClient, getAuthMode } from "@/lib/auth/session";

// Google → Supabase → here. Exchanges the one-time code for a session cookie,
// then rejects anyone who isn't allowed (and signs them straight back out).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const toLogin = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, origin));

  if (getAuthMode() !== "required") return toLogin("config");
  const code = searchParams.get("code");
  if (!code) return toLogin("oauth");

  const supabase = await createAuthClient();
  const exchange = await supabase.auth.exchangeCodeForSession(code);
  if (exchange.error) return toLogin("oauth");

  const { data } = await supabase.auth.getClaims();
  if (!isStaff(data?.claims as StaffClaims | undefined, allowedDomains())) {
    await supabase.auth.signOut();
    return toLogin("domain");
  }
  const next = safeNextPath(request.cookies.get(NEXT_PATH_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.delete({ name: NEXT_PATH_COOKIE, path: "/auth" });
  return response;
}
