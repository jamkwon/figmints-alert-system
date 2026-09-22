"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-fig-coral-wash px-6 py-5">
      <h1 className="text-lg font-semibold text-red-900">Something went wrong loading this page</h1>
      <p className="mt-1 text-sm text-red-800">
        {error.message || "Unexpected error."} If this mentions Supabase, check the connection details on the Settings
        page and in the README.
      </p>
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
