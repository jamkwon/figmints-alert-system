import type { Metadata } from "next";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { Avatar } from "@/components/account-bar";
import { Panel, PageHeader, When } from "@/components/ui";
import { allowedDomains, getStaffProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Profile" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-fig-ink">{children}</dd>
    </div>
  );
}

export default async function ProfilePage() {
  const profile = await getStaffProfile();

  if (!profile) {
    return (
      <>
        <PageHeader title="Profile" />
        <Panel>
          <p className="px-4 py-6 text-sm text-slate-600">
            The app is running on sample data, so there&apos;s no sign-in and no account. Connect Supabase to turn on
            login (see the README).
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" description="The account you're signed in with." />

      <div className="grid max-w-3xl gap-6">
        <Panel>
          <div className="flex items-center gap-4 px-4 py-5">
            <Avatar user={profile} size="lg" />
            <div>
              <div className="font-display text-xl font-bold text-fig-plum-dark">{profile.name ?? profile.email}</div>
              {profile.name && <div className="text-sm text-slate-600">{profile.email}</div>}
            </div>
          </div>
        </Panel>

        <Panel title="Account">
          <dl>
            <Row label="Name">{profile.name ?? <span className="text-slate-400">Not provided by Google</span>}</Row>
            <Row label="Email">{profile.email}</Row>
            <Row label="Signed in with">{profile.provider === "google" ? "Google" : profile.provider}</Row>
            <Row label="Access">
              Full access{" "}
              <span className="text-slate-500">
                (every Figmints account can view everything, run checks and update incidents)
              </span>
            </Row>
            <Row label="Allowed accounts">{allowedDomains().map((d) => `@${d}`).join(", ")}</Row>
          </dl>
        </Panel>

        <Panel title="Session">
          <dl>
            <Row label="Account created">
              <When iso={profile.createdAt} empty="Unknown" />
            </Row>
            <Row label="Last sign-in">
              <When iso={profile.lastSignInAt} empty="Unknown" />
            </Row>
            <Row label="Session refreshes">
              <When iso={profile.sessionExpiresAt} empty="Unknown" />
              <span className="mt-1 block text-xs text-slate-500">
                Renews automatically while you use the app. Signing out ends it on this browser.
              </span>
            </Row>
          </dl>
          <div className="border-t border-slate-100 px-4 py-3">
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-fig-ink hover:border-fig-plum hover:text-fig-plum"
              >
                Sign out
              </button>
            </form>
          </div>
        </Panel>
      </div>
    </>
  );
}
