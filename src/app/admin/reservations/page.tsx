import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { listBranches } from "@/lib/fleet/catalog";
import { listReservations } from "@/lib/reservations";
import { addDays, formatDateTime, isDateString, zonedTimeToUtc } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusBadge, statusPresentation } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Input, Select } from "@/components/ui/form-controls";
import { ClipboardIcon, SearchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../_lib/auth";

export const metadata: Metadata = { title: "Reservations" };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const;
const SORTS = { pickup_asc: "Pick-up: soonest first", pickup_desc: "Pick-up: latest first", created_desc: "Newest bookings" } as const;
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/reservations");
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = one("q").slice(0, 100);
  const status = (STATUSES as readonly string[]).includes(one("status")) ? (one("status") as (typeof STATUSES)[number]) : undefined;
  const branchId = UUID.test(one("branch")) ? one("branch") : "";
  const from = isDateString(one("from")) ? one("from") : "";
  const to = isDateString(one("to")) ? one("to") : "";
  const sort = one("sort") in SORTS ? (one("sort") as keyof typeof SORTS) : "pickup_asc";
  const balanceDue = one("balance") === "1";
  const page = Math.max(1, Number.parseInt(one("page") || "1", 10) || 1);

  const branches = await listBranches({ includeInactive: true });
  const tz = branches.find((b) => b.id === branchId)?.timezone ?? branches[0]?.timezone ?? "UTC";
  const { total, items } = await listReservations(actor, {
    q: q || undefined,
    status,
    branchId: branchId || undefined,
    pickupFrom: from ? zonedTimeToUtc(from, "00:00", tz) : undefined,
    pickupTo: to ? zonedTimeToUtc(addDays(to, 1), "00:00", tz) : undefined,
    sort,
    balanceDue: balanceDue || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const filters: Record<string, string> = Object.fromEntries(
    Object.entries({ q, status: status ?? "", branch: branchId, from, to, sort: sort === "pickup_asc" ? "" : sort, balance: balanceDue ? "1" : "" }).filter(([, v]) => v),
  );
  const filtered = Boolean(q || status || branchId || from || to || balanceDue);

  return (
    <>
      <PageHeader title="Reservations" description={`${total} ${total === 1 ? "reservation" : "reservations"}${filtered ? " match your filters" : ""}.`} />
      <Form action="/admin/reservations" className="mb-6 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <label htmlFor="r-q" className="mb-1 block text-sm font-semibold text-ink">
            Search
          </label>
          <Input id="r-q" name="q" defaultValue={q} placeholder="Reference, customer, email or plate" leading={<SearchIcon size={18} />} />
        </div>
        <div>
          <label htmlFor="r-status" className="mb-1 block text-sm font-semibold text-ink">
            Status
          </label>
          <Select id="r-status" name="status" defaultValue={status ?? ""} placeholder="All" options={STATUSES.map((s) => ({ value: s, label: statusPresentation("reservation", s).label }))} />
        </div>
        <div>
          <label htmlFor="r-branch" className="mb-1 block text-sm font-semibold text-ink">
            Pick-up branch
          </label>
          <Select id="r-branch" name="branch" defaultValue={branchId} placeholder="All" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        <div>
          <label htmlFor="r-from" className="mb-1 block text-sm font-semibold text-ink">
            Pick-up from
          </label>
          <Input id="r-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <label htmlFor="r-to" className="mb-1 block text-sm font-semibold text-ink">
            Pick-up to
          </label>
          <Input id="r-to" name="to" type="date" defaultValue={to} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="r-sort" className="mb-1 block text-sm font-semibold text-ink">
            Sort
          </label>
          <Select id="r-sort" name="sort" defaultValue={sort} options={Object.entries(SORTS).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="flex items-end sm:col-span-2">
          <Checkbox id="r-balance" name="balance" value="1" label="Balance due only" defaultChecked={balanceDue} />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2">
          <Button type="submit">Apply</Button>
          {filtered && (
            <Link href="/admin/reservations" className={buttonClasses("ghost")}>
              Clear filters
            </Link>
          )}
        </div>
      </Form>

      <DataTable
        caption="Reservations"
        rows={items}
        getRowKey={(r) => r.id}
        empty={<EmptyState icon={<ClipboardIcon />} title={filtered ? "No reservations match" : "No reservations yet"} />}
        columns={[
          {
            key: "ref",
            header: "Reference",
            cell: (r) => (
              <Link href={`/admin/reservations/${r.reference}`} className="font-mono font-semibold text-brand-800 hover:underline">
                {r.reference}
              </Link>
            ),
          },
          { key: "customer", header: "Customer", cell: (r) => <span className="block max-w-48 truncate">{r.customer.name}</span> },
          { key: "vehicle", header: "Vehicle", cell: (r) => r.vehicle.name },
          { key: "pickup", header: "Pick-up", cell: (r) => `${formatDateTime(r.pickupAt, r.timezone)} · ${r.pickupBranch.code}` },
          { key: "return", header: "Return", cell: (r) => `${formatDateTime(r.returnAt, r.returnBranch.timezone)} · ${r.returnBranch.code}` },
          { key: "status", header: "Status", cell: (r) => <StatusBadge kind="reservation" status={r.status} /> },
          {
            key: "total",
            header: "Total",
            align: "right",
            cell: (r) => (
              <span className="tabular">
                {formatMoney(r.price.totalFils, "AED")}
                {r.balanceDueFils > 0 && <span className="block text-xs font-semibold text-red-800">Due {formatMoney(r.balanceDueFils, "AED")}</span>}
              </span>
            ),
          },
        ]}
      />
      <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pathname="/admin/reservations" searchParams={filters} label="Reservation pages" className="mt-6" />
    </>
  );
}
