import { PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function VehicleLoading() {
  return (
    <div className="container-page py-8 sm:py-10" role="status" aria-busy="true">
      <span className="sr-only">Loading vehicle…</span>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Skeleton className="aspect-[16/10] w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-[520px] rounded-xl" />
      </div>
    </div>
  );
}
