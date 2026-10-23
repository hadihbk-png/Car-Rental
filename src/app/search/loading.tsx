import { PageHeaderSkeleton, Skeleton, VehicleGridSkeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <Skeleton className="h-11 w-full rounded-lg lg:h-[640px] lg:rounded-xl" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full max-w-md" />
          <VehicleGridSkeleton count={6} />
        </div>
      </div>
    </div>
  );
}
