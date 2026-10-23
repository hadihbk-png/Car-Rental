import type { Metadata } from "next";
import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { listFleet } from "@/lib/fleet/admin";
import { listBranches, listCategories } from "@/lib/fleet/catalog";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusBadge, statusPresentation } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form-controls";
import { CarIcon, SearchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../../_lib/auth";
import { VEHICLE_STATUSES } from "../vehicle-form";

export const metadata: Metadata = { title: "Fleet" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminFleetPage({ searchParams }: PageProps<"/admin/fleet">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/fleet");
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = one("q").slice(0, 60);
  const branchId = UUID.test(one("branch")) ? one("branch") : "";
  const categoryId = UUID.test(one("category")) ? one("category") : "";
  const status = (VEHICLE_STATUSES as readonly string[]).includes(one("status")) ? (one("status") as (typeof VEHICLE_STATUSES)[number]) : undefined;

  const [fleet, branches, categories] = await Promise.all([
    listFleet(actor, { q: q || undefined, branchId: branchId || undefined, categoryId: categoryId || undefined, status }),
    listBranches({ includeInactive: true }),
    listCategories(),
  ]);
  const filtered = Boolean(q || branchId || categoryId || status);

  return (
    <>
      <PageHeader
        title="Fleet"
        description={`${fleet.length} ${fleet.length === 1 ? "vehicle" : "vehicles"}${filtered ? " match your filters" : ""}.`}
        actions={
          <Link href="/admin/fleet/new" className={buttonClasses("primary")}>
            Add vehicle
          </Link>
        }
      />
      <Form action="/admin/fleet" className="mb-6 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div>
          <label htmlFor="fleet-q" className="mb-1 block text-sm font-semibold text-ink">
            Search
          </label>
          <Input id="fleet-q" name="q" defaultValue={q} placeholder="Plate, VIN, make or model" leading={<SearchIcon size={18} />} />
        </div>
        <div>
          <label htmlFor="fleet-branch" className="mb-1 block text-sm font-semibold text-ink">
            Branch
          </label>
          <Select id="fleet-branch" name="branch" defaultValue={branchId} placeholder="All" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        <div>
          <label htmlFor="fleet-cat" className="mb-1 block text-sm font-semibold text-ink">
            Category
          </label>
          <Select id="fleet-cat" name="category" defaultValue={categoryId} placeholder="All" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div>
          <label htmlFor="fleet-status" className="mb-1 block text-sm font-semibold text-ink">
            Status
          </label>
          <Select
            id="fleet-status"
            name="status"
            defaultValue={status ?? ""}
            placeholder="All"
            options={VEHICLE_STATUSES.map((s) => ({ value: s, label: statusPresentation("vehicle", s).label }))}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Filter</Button>
          {filtered && (
            <Link href="/admin/fleet" className={buttonClasses("ghost")}>
              Clear
            </Link>
          )}
        </div>
      </Form>
      <DataTable
        caption="Vehicles"
        rows={fleet}
        getRowKey={(v) => v.id}
        empty={
          <EmptyState
            icon={<CarIcon />}
            title={filtered ? "No vehicles match" : "No vehicles yet"}
            actions={
              filtered ? (
                <Link href="/admin/fleet" className={buttonClasses("outline")}>
                  Clear filters
                </Link>
              ) : (
                <Link href="/admin/fleet/new" className={buttonClasses("primary")}>
                  Add vehicle
                </Link>
              )
            }
          />
        }
        columns={[
          {
            key: "name",
            header: "Vehicle",
            cell: (v) => (
              <Link href={`/admin/fleet/${v.id}`} className="flex items-center gap-3 font-semibold text-brand-800 hover:underline">
                <span className="relative hidden h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-muted md:block">
                  {v.photoUrls[0] && <Image src={v.photoUrls[0]} alt="" fill sizes="64px" className="object-cover" />}
                </span>
                {v.make} {v.model} {v.year}
              </Link>
            ),
          },
          { key: "plate", header: "Plate", cell: (v) => <span className="font-mono">{v.plateNumber}</span> },
          { key: "branch", header: "Branch", cell: (v) => v.branchCode },
          { key: "category", header: "Category", cell: (v) => v.categoryName },
          { key: "km", header: "Mileage", align: "right", cell: (v) => `${v.mileageKm.toLocaleString("en-GB")} km` },
          { key: "status", header: "Status", cell: (v) => <StatusBadge kind="vehicle" status={v.status} /> },
        ]}
      />
    </>
  );
}
