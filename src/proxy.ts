import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isStaff, parseAllowedDomains, type StaffClaims } from "@/lib/auth/allowed";
import { PUBLIC_KEY_VARS, URL_VARS, firstSetEnv, isSupabaseConfigured } from "@/lib/supabase/config";

// Runs before every page and server action: refreshes the Supabase login session
// and sends anyone who isn't signed-in staff to /login. Pages, data loading and
// actions check again (src/lib/auth/session.ts); this is the first line, not the only one.

const PUBLIC_PATHS = ["/login", "/auth/"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  // Sample-data mode: no real data, no login.
  if (!isSupabaseConfigured()) return NextResponse.next();

  const url = firstSetEnv(URL_VARS);
  const key = firstSetEnv(PUBLIC_KEY_VARS);
  if (!url || !key) return redirectToLogin(request, "config");

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url.value, key.value, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });

  // Verifies the token and refreshes it if it's about to expire.
  const { data } = await supabase.auth.getClaims();
  if (!isStaff(data?.claims as StaffClaims | undefined, parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS))) {
    return redirectToLogin(request, undefined, pathname + search);
  }
  return response;
}

function redirectToLogin(request: NextRequest, error?: string, next?: string) {
  const target = new URL("/login", request.url);
  if (error) target.searchParams.set("error", error);
  if (next && next !== "/") target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: [
    // Everything except static files, images, the favicon and the scheduler endpoint
    // (which has its own CRON_SECRET check).
    "/((?!_next/static|_next/image|icon.svg|favicon.ico|figmints-logo-white.svg|api/cron/).*)",
  ],
};
