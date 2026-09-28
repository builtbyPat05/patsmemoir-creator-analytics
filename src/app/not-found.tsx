import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-state-page">
      <div className="system-state-content">
        <p className="eyebrow">Page not found</p>
        <h1>This dashboard view doesn&apos;t exist.</h1>
        <p>Return to your overview to continue reviewing your analytics.</p>
        <Link className="system-state-button" href="/">
          <ArrowLeft size={17} aria-hidden="true" />
          Back to overview
        </Link>
      </div>
    </main>
  );
}
