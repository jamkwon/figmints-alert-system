import Link from "next/link";
import { signOut } from "@/app/login/actions";
import type { StaffUser } from "@/lib/auth/session";
import { initials } from "@/lib/format";

export function Avatar({ user, size = "sm" }: { user: StaffUser; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-fig-plum font-semibold text-white ${
        size === "lg" ? "size-14 text-lg" : "size-8 text-xs"
      }`}
    >
      {initials(user.name, user.email)}
    </span>
  );
}

/** Top-right of every page: who is signed in, a link to their profile, and sign out. */
export function AccountBar({ user }: { user: StaffUser | null }) {
  // Sample-data mode has no sign-in; the sample-data banner already says so.
  if (!user) return null;
  return (
    <div className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-slate-200 bg-white px-8">
      <Link
        href="/profile"
        title="Your profile"
        className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-fig-plum-mist"
      >
        <Avatar user={user} />
        <span className="text-left leading-tight">
          <span className="block text-sm font-medium text-fig-ink">{user.name ?? user.email}</span>
          {user.name && <span className="block text-xs text-slate-500">{user.email}</span>}
        </span>
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-sm text-slate-500 hover:text-fig-plum hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
