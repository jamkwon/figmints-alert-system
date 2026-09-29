"use client";

/** Opens the browser's print dialog, where "Save as PDF" makes a file to send. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-fig-plum bg-fig-plum px-3 py-1.5 text-sm font-medium text-white hover:bg-fig-magenta"
    >
      Print / Save as PDF
    </button>
  );
}
