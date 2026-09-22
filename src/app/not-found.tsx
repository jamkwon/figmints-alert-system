import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold text-fig-ink">Not found</h1>
      <p className="mt-1 text-sm text-slate-600">That page or record doesn’t exist.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-fig-plum hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
