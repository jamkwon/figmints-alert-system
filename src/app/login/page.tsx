import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/allowed";
import { allowedDomains, getAuthMode, getStaffUser } from "@/lib/auth/session";
import { signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, { text: string; tone: "error" | "info" }> = {
  domain: { text: "That Google account isn't allowed. Sign in with your Figmints Google account.", tone: "error" },
  oauth: { text: "Sign-in didn't complete. Please try again.", tone: "error" },
  config: {
    text: "Login isn't configured yet: the Supabase publishable key is missing. See the README (Login).",
    tone: "error",
  },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const mode = getAuthMode();
  if (mode === "required" && (await getStaffUser())) redirect(next);

  const error = typeof params.error === "string" ? MESSAGES[params.error] : undefined;
  const message = error ?? (params.signed_out ? { text: "You've been signed out.", tone: "info" as const } : undefined);
  const domain = allowedDomains()[0];

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-fig-brand px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <Image src="/figmints-logo-white.svg" alt="Figmints" width={150} height={46} priority className="mx-auto" />
          <h1 className="mt-4 font-display text-2xl font-bold">Website Watch</h1>
          <p className="text-sm text-white/60">Website Health Monitor · internal</p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-lg">
          {message && (
            <p
              role="status"
              className={`mb-4 rounded-md px-3 py-2 text-sm ${
                message.tone === "error" ? "bg-fig-coral-wash text-red-800" : "bg-fig-teal-wash text-fig-teal"
              }`}
            >
              {message.text}
            </p>
          )}

          {mode === "disabled" ? (
            <div className="space-y-3 text-sm text-slate-600">
              <p>Login is off because the app is running on built-in sample data (Supabase isn&apos;t configured).</p>
              <Link href="/" className="font-medium text-fig-plum hover:underline">
                Go to the dashboard →
              </Link>
            </div>
          ) : (
            <form action={signInWithGoogle}>
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                disabled={mode === "misconfigured"}
                className="flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-fig-ink hover:border-fig-plum hover:bg-fig-plum-mist disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg aria-hidden viewBox="0 0 48 48" className="size-5">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Sign in with Google
              </button>
              <p className="mt-3 text-center text-xs text-slate-500">
                Use your <strong>@{domain}</strong> account.
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
