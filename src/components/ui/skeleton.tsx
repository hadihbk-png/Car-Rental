import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** Grey placeholder block. Size it with the same classes as the real content to avoid layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-md bg-surface-muted", className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Wraps skeletons with a screen-reader status so loading is announced once. */
export function LoadingRegion({ label = "Loading", children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Matches VehicleCard dimensions. */
export function VehicleCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card" aria-hidden="true">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-3/4" />
        <div className="flex gap-3">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="mt-2 flex items-end justify-between border-t border-line pt-4">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-11 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function VehicleGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <LoadingRegion label="Loading vehicles">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <VehicleCardSkeleton key={i} />
        ))}
      </div>
    </LoadingRegion>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <LoadingRegion label="Loading table">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="hidden gap-4 border-b border-line bg-canvas px-4 py-3 md:flex">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0 md:flex-row md:gap-4">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className={cn("h-4 md:flex-1", c === 0 ? "w-1/2" : "w-full")} />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 pb-6" aria-hidden="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}
