"use client";

import { RotateCcw } from "lucide-react";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="system-state-page">
      <div className="system-state-content">
        <p className="eyebrow">Dashboard unavailable</p>
        <h1>We couldn&apos;t load your analytics.</h1>
        <p>Your data is safe. Try loading this view again.</p>
        <button className="system-state-button" onClick={reset} type="button">
          <RotateCcw size={17} aria-hidden="true" />
          Try again
        </button>
      </div>
    </main>
  );
}
