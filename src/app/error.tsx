"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/layout/status-page";
import { Button, ButtonLink } from "@/components/ui/button";

function digestOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string") return error.digest;
  return undefined;
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);

  useEffect(() => {
    // Server errors are logged on the server with this digest; client errors surface here.
    console.error(error);
  }, [error]);

  return (
    <StatusPage
      code="Error"
      title="Something went wrong"
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href="/" variant="outline">
            Go to home page
          </ButtonLink>
        </>
      }
    >
      <p>We couldn&apos;t load this page. Your bookings and payments are not affected. Please try again in a moment.</p>
      {digest && (
        <p className="mt-3 text-sm text-ink-subtle">
          Reference: <code className="font-mono">{digest}</code>
        </p>
      )}
    </StatusPage>
  );
}
