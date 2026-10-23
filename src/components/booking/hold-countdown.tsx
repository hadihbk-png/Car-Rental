"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/ui/cn";
import { ClockIcon } from "@/components/ui/icons";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** "Car held for 12:34". Refreshes the route once when the hold expires. */
export function HoldCountdown({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const router = useRouter();
  // Server render has no clock reading (null); the client ticks every second.
  const now = useSyncExternalStore(subscribe, nowSeconds, () => null);
  const end = Math.floor(new Date(expiresAt).getTime() / 1000);
  const remaining = now === null ? null : Math.max(0, end - now);
  const refreshed = useRef(false);

  useEffect(() => {
    if (remaining === 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [remaining, router]);

  const mm = remaining === null ? "--" : String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = remaining === null ? "--" : String(remaining % 60).padStart(2, "0");
  const urgent = remaining !== null && remaining < 120;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-4",
        urgent ? "border-amber-300 bg-amber-50 text-amber-950" : "border-brand-200 bg-brand-50 text-brand-900",
        className,
      )}
    >
      <ClockIcon className={urgent ? "text-amber-700" : "text-brand-700"} />
      <p className="text-sm">
        {remaining === 0 ? (
          <span className="font-semibold">Your hold has expired.</span>
        ) : (
          <>
            We&apos;re holding this car for you for{" "}
            <span className="font-mono text-base font-bold tabular" role="timer" aria-live="off">
              {mm}:{ss}
            </span>
            <span className="sr-only"> minutes</span>. Complete payment before the timer runs out.
          </>
        )}
      </p>
    </div>
  );
}
