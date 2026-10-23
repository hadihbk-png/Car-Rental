"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Replaces the root layout when it fails. It renders its own document, so it imports the
 * global styles itself and uses system fonts (next/font from the layout is not available).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : undefined;

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-canvas p-6 font-sans text-ink">
        <title>Something went wrong · DriveEasy</title>
        <main className="max-w-md text-center">
          <p className="text-sm font-bold tracking-widest text-brand-700 uppercase">DriveEasy</p>
          <h1 className="mt-2 text-3xl font-extrabold">Something went wrong</h1>
          <p className="mt-4 text-ink-muted">
            The site hit an unexpected problem. Your bookings and payments are not affected. Please try again.
          </p>
          {digest && (
            <p className="mt-3 text-sm text-ink-subtle">
              Reference: <code className="font-mono">{digest}</code>
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Try again
            </button>
            {/* A full page load is intended here: the app shell itself failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-lg border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:border-brand-600"
            >
              Go to home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
