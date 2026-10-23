import { LoadingRegion, PageHeaderSkeleton, SkeletonText, Skeleton } from "@/components/ui/skeleton";

/** Default route loading state: page header + content skeleton inside the normal page container. */
export default function Loading() {
  return (
    <LoadingRegion label="Loading page" className="container-page py-8 sm:py-10">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-card">
          <Skeleton className="h-6 w-1/3" />
          <SkeletonText lines={4} />
        </div>
        <div className="hidden flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-card lg:flex">
          <Skeleton className="h-6 w-1/2" />
          <SkeletonText lines={3} />
        </div>
      </div>
    </LoadingRegion>
  );
}
