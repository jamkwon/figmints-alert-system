// For clients: no link back into the staff app.
export default function SharedReportNotFound() {
  return (
    <div className="mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-fig-ink">This link isn’t active</h1>
      <p className="mt-1 text-sm text-slate-600">Ask your Figmints contact for a new link to your website report.</p>
    </div>
  );
}
