import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { listFleet } from "@/lib/fleet/admin";
import { listDamageReports } from "@/lib/reservations";
import { formatDate } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { defaultTimeZone } from "@/app/_lib/trip";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Select } from "@/components/ui/form-controls";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../../_lib/auth";
import { SEVERITY_TONE, STAGE_LABEL } from "../_lib";

export const metadata: Metadata = { title: "Damage reports" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function DamagePage({ searchParams }: PageProps<"/admin/damage">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/damage");
  const vehicleId = typeof sp.vehicle === "string" && UUID.test(sp.vehicle) ? sp.vehicle : undefined;
  const openOnly = sp.open === "1";
  const [reports, fleet, tz] = await Promise.all([listDamageReports(actor, { vehicleId, openOnly }), listFleet(actor), defaultTimeZone()]);

  return (
    <>
      <PageHeader
        title="Damage reports"
        description="Record damage found at pick-up or return, with photos and estimated cost."
        actions={
          <Link href="/admin/damage/new" className={buttonClasses("primary")}>
            New report
          </Link>
        }
      />
      <Form action="/admin/damage" className="mb-6 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="dmg-vehicle" className="mb-1 block text-sm font-semibold text-ink">
            Vehicle
          </label>
          <Select id="dmg-vehicle" name="vehicle" defaultValue={vehicleId ?? ""} placeholder="All vehicles" options={fleet.map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.plateNumber}` }))} />
        </div>
        <Checkbox id="dmg-open" name="open" value="1" label="Open reports only" defaultChecked={openOnly} />
        <Button type="submit">Filter</Button>
      </Form>
      <DataTable
        caption="Damage reports"
        rows={reports}
        getRowKey={(d) => d.id}
        empty={<EmptyState icon={<AlertTriangleIcon />} title="No damage reports" description={openOnly || vehicleId ? "Nothing matches these filters." : "Nothing has been reported yet."} />}
        columns={[
          {
            key: "loc",
            header: "Damage",
            cell: (d) => (
              <Link href={`/admin/damage/${d.id}`} className="font-semibold text-brand-800 hover:underline">
                {d.location}
              </Link>
            ),
          },
          { key: "vehicle", header: "Vehicle", cell: (d) => `${d.vehicleName} · ${d.plateNumber}` },
          { key: "sev", header: "Severity", cell: (d) => <Badge tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{d.severity.toLowerCase()}</Badge> },
          { key: "stage", header: "Found", cell: (d) => STAGE_LABEL[d.stage] ?? d.stage },
          {
            key: "res",
            header: "Reservation",
            cell: (d) =>
              d.reservationReference ? (
                <Link href={`/admin/reservations/${d.reservationReference}`} className="font-mono text-brand-800 hover:underline">
                  {d.reservationReference}
                </Link>
              ) : (
                "—"
              ),
          },
          { key: "cost", header: "Estimate", align: "right", cell: (d) => formatMoney(d.estimatedCostFils, "AED") },
          { key: "date", header: "Reported", cell: (d) => formatDate(d.createdAt, tz) },
          { key: "status", header: "Status", cell: (d) => (d.resolvedAt ? <Badge tone="success" dot>Resolved</Badge> : <Badge tone="warning" dot>Open</Badge>) },
        ]}
      />
    </>
  );
}
