"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // In production, server errors reach the browser without their message (only a digest),
  // so point people to the server logs instead of showing React's generic text.
  const fromServer = Boolean(error.digest);

  return (
    <div className="rounded-lg border border-red-200 bg-fig-coral-wash px-6 py-5">
      <h1 className="text-lg font-semibold text-red-900">Something went wrong loading this page</h1>
      {fromServer ? (
        <p className="mt-1 text-sm text-red-800">
          The server couldn&apos;t load this page. This is usually a database problem: missing tables or wrong Supabase
          settings. Look for error ID <code className="rounded bg-white/60 px-1">{error.digest}</code> in the Vercel
          runtime logs for the details, and check the Settings page.
        </p>
      ) : (
        <p className="mt-1 text-sm text-red-800">{error.message || "Unexpected error."}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-fig-plum px-3 py-1.5 text-sm font-medium text-white hover:bg-fig-magenta"
      >
        Try again
      </button>
    </div>
  );
}
