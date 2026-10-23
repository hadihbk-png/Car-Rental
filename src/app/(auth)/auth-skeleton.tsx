import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/** Same height as the auth forms, so nothing jumps when the session check resolves. */
export function AuthFormSkeleton({ fields }: { fields: number }) {
  return (
    <LoadingRegion label="Loading form" className="flex flex-col gap-5">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="mx-auto h-5 w-56" />
    </LoadingRegion>
  );
}
