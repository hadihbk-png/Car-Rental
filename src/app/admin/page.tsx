import type { Metadata } from "next";
import Link from "next/link";
import { listFleet } from "@/lib/fleet/admin";
import { listBranches } from "@/lib/fleet/catalog";
import { listDamageReports, listReservations } from "@/lib/reservations";
import { addDays, formatDate, formatTime, todayInTimeZone, zonedTimeToUtc } from "@/lib/ui/datetime";
import { StatusBadge, statusPresentation } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "./_lib/auth";
import { VEHICLE_STATUSES } from "./fleet/vehicle-form";

export const metadata: Metadata = { title: "Overview" };

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-raised">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-3xl font-extrabold text-ink tabular">{value}</p>
    </Link>
  );
}

export default async function AdminHome() {
  const actor = await requireAdminPage("/admin");
  const branches = await listBranches();
  const tz = branches[0]?.timezone ?? "UTC";
  const now = new Date();
  const today = todayInTimeZone(now, tz);
  const dayStart = zonedTimeToUtc(today, "00:00", tz);
  const dayEnd = zonedTimeToUtc(addDays(today, 1), "00:00", tz);

  const [pickups, onRent, pending, damage, fleet, owing] = await Promise.all([
    listReservations(actor, { status: "CONFIRMED", pickupFrom: dayStart, pickupTo: dayEnd, sort: "pickup_asc", limit: 20 }),
    listReservations(actor, { status: "PICKED_UP", limit: 200 }),
    listReservations(actor, { status: "PENDING", limit: 1 }),
    listDamageReports(actor, { openOnly: true }),
    listFleet(actor),
    listReservations(actor, { balanceDue: true, limit: 1 }),
  ]);
  const returnsToday = onRent.items.filter((r) => r.returnAt >= dayStart && r.returnAt < dayEnd);
  const overdue = onRent.items.filter((r) => r.returnAt < now);

  return (
    <>
      <PageHeader title="Overview" description={`Today, ${formatDate(now, tz, "long")} (${branches.length} active branches).`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pick-ups today" value={pickups.total} href="/admin/check-out" />
        <Stat label="Returns due today" value={returnsToday.length} href="/admin/check-in" />
        <Stat label="Cars on rent" value={onRent.total} href="/admin/reservations?status=PICKED_UP" />
        <Stat label="Open damage reports" value={damage.length} href="/admin/damage?open=1" />
      </div>
      {(overdue.length > 0 || pending.total > 0 || owing.total > 0) && (
        <p className="mt-4 text-sm text-ink-muted">
          {overdue.length > 0 && <span className="font-semibold text-red-800">{overdue.length} overdue return(s). </span>}
          {pending.total > 0 && (
            <Link href="/admin/reservations?status=PENDING" className="underline">
              {pending.total} booking(s) awaiting payment
            </Link>
          )}
          {owing.total > 0 && (
            <>
              {" "}
              <Link href="/admin/reservations?balance=1" className="font-semibold text-red-800 underline">
                {owing.total} customer(s) with a balance due
              </Link>
            </>
          )}
        </p>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Today's pick-ups" actions={<Link href="/admin/check-out" className={buttonClasses("outline", "sm")}>Check-out desk</Link>} />
          <CardBody>
            {pickups.items.length === 0 ? (
              <p className="text-sm text-ink-muted">No pick-ups scheduled for today.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {pickups.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/admin/check-out?ref=${r.reference}`} className="font-semibold text-brand-800 hover:underline">
                      {formatTime(r.pickupAt, r.timezone)} · {r.customer.name}
                    </Link>
                    <span className="text-ink-muted">
                      {r.vehicle.name} · {r.pickupBranch.code}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Returns due today" actions={<Link href="/admin/check-in" className={buttonClasses("outline", "sm")}>Check-in desk</Link>} />
          <CardBody>
            {returnsToday.length === 0 ? (
              <p className="text-sm text-ink-muted">No returns due today.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {returnsToday.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/admin/check-in?ref=${r.reference}`} className="font-semibold text-brand-800 hover:underline">
                      {formatTime(r.returnAt, r.returnBranch.timezone)} · {r.customer.name}
                    </Link>
                    <span className="text-ink-muted">
                      {r.vehicle.name} · {r.returnBranch.code}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Fleet status" actions={<Link href="/admin/fleet" className={buttonClasses("outline", "sm")}>Manage fleet</Link>} />
          <CardBody>
            <ul className="flex flex-wrap gap-3">
              {VEHICLE_STATUSES.map((s) => (
                <li key={s}>
                  <Link href={`/admin/fleet?status=${s}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-canvas">
                    <StatusBadge kind="vehicle" status={s} />
                    <span className="font-bold tabular">{fleet.filter((v) => v.status === s).length}</span>
                    <span className="sr-only">{statusPresentation("vehicle", s).label} vehicles</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
