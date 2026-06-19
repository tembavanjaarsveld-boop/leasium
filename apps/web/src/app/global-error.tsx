"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-6 text-[var(--text-primary)]">
          <section className="max-w-md space-y-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Leasium
            </p>
            <h1 className="text-2xl font-semibold">Something went wrong.</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              The issue has been recorded for review. Refresh to try again.
            </p>
            <button
              type="button"
              className="min-h-11 rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
