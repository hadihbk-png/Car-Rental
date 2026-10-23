import type { Metadata } from "next";
import Link from "next/link";
import { listBranches } from "@/lib/fleet/catalog";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MapPinIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../../_lib/auth";

export const metadata: Metadata = { title: "Branches" };

export default async function AdminBranchesPage({ searchParams }: PageProps<"/admin/branches">) {
  const sp = await searchParams;
  await requireAdminPage("/admin/branches");
  const branches = await listBranches({ includeInactive: true });

  return (
    <>
      <PageHeader
        title="Branches"
        description="Locations where customers pick up and return cars."
        actions={
          <Link href="/admin/branches/new" className={buttonClasses("primary")}>
            Add branch
          </Link>
        }
      />
      {sp.deleted && (
        <Notice tone="success" className="mb-4" live>
          Branch deleted.
        </Notice>
      )}
      <DataTable
        caption="Branches"
        rows={branches}
        getRowKey={(b) => b.id}
        empty={<EmptyState icon={<MapPinIcon />} title="No branches yet" actions={<Link href="/admin/branches/new" className={buttonClasses("primary")}>Add branch</Link>} />}
        columns={[
          {
            key: "name",
            header: "Branch",
            cell: (b) => (
              <Link href={`/admin/branches/${b.id}`} className="font-semibold text-brand-800 hover:underline">
                {b.name}
              </Link>
            ),
          },
          { key: "code", header: "Code", cell: (b) => <span className="font-mono">{b.code}</span> },
          { key: "city", header: "City", cell: (b) => b.city },
          { key: "hours", header: "Hours", cell: (b) => b.openingHours ?? "—" },
          { key: "tz", header: "Time zone", cell: (b) => b.timezone },
          {
            key: "status",
            header: "Status",
            cell: (b) => (b.isActive ? <Badge tone="success" dot>Open</Badge> : <Badge dot>Inactive</Badge>),
          },
        ]}
      />
    </>
  );
}
