import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
