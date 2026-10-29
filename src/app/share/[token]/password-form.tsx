"use client";

import { useActionState } from "react";
import { unlockShareAction, type UnlockState } from "./actions";

export function SharePasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockShareAction.bind(null, token), {});
  return (
    <form action={action} className="mt-6 space-y-3 text-left">
      <label htmlFor="password" className="block text-sm font-medium text-fig-ink">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        maxLength={100}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base tracking-wider text-fig-ink focus:border-fig-plum focus:outline-none"
      />
      {state.message && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-fig-plum bg-fig-plum px-3 py-2 text-sm font-medium text-white hover:bg-fig-magenta disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Checking…" : "View report"}
      </button>
    </form>
  );
}
