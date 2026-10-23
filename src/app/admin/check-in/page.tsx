import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFleetVehicle } from "@/lib/fleet/admin";
import { listBranches } from "@/lib/fleet/catalog";
import { listReservations } from "@/lib/reservations";
import { formatDateTime, timeZoneLabel } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../_lib/auth";
import { lookupReservation } from "../_lib/lookup";
import { ActionForm, FMoney, FSelect, FText, FTextarea } from "../_components/action-form";
import { FUEL_OPTIONS_EIGHTHS, ReservationCard } from "../_components/reservation-card";
import { VoucherLookup } from "../_components/voucher-lookup";
import { checkInAction } from "./actions";

export const metadata: Metadata = { title: "Check-in" };

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? "border-t border-line pt-2 font-bold" : ""}`}>
      <dt className={strong ? "text-ink" : "text-ink-muted"}>{label}</dt>
      <dd className="text-right text-ink tabular">{children}</dd>
    </div>
  );
}

export default async function CheckInPage({ searchParams }: PageProps<"/admin/check-in">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/check-in");
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const { r, error } = await lookupReservation(actor, ref);
  const [branches, onRent] = await Promise.all([listBranches({ includeInactive: true }), listReservations(actor, { status: "PICKED_UP", sort: "pickup_asc", limit: 100 })]);
  const vehicle = r && r.status === "PICKED_UP" ? await getFleetVehicle(actor, r.vehicle.id) : null;
  const a = r?.agreement;

  return (
    <>
      <PageHeader title="Check-in" description="Take a car back: record mileage, fuel and any damage. Late, fuel and damage charges are calculated for you." />
      <Card padded className="mb-6">
        <VoucherLookup defaultValue={ref} />
      </Card>
      {error && (
        <Notice tone="error" className="mb-6" live>
          {error}
        </Notice>
      )}

      {r && (
        <div className="mb-8 flex flex-col gap-4">
          <ReservationCard r={r} />
          {r.status === "PICKED_UP" ? (
            <Card>
              <CardHeader
                title="Return the car"
                description={a?.pickupMileageKm != null ? `Out: ${a.pickupMileageKm.toLocaleString("en-GB")} km, fuel ${a.pickupFuelLevel}/8.` : undefined}
              />
              <CardBody>
                <ActionForm action={checkInAction.bind(null, r.id, r.returnBranch.timezone)} submitLabel="Confirm check-in" pendingLabel="Checking in…" fieldsClassName="sm:grid-cols-2">
                  <FText name="mileageKm" label="Mileage (km)" type="number" inputMode="numeric" min={0} required defaultValue={vehicle?.mileageKm} />
                  <FSelect name="fuelLevel" label="Fuel level" required options={FUEL_OPTIONS_EIGHTHS} defaultValue={String(a?.pickupFuelLevel ?? 8)} />
                  <FText name="returnedDate" type="date" label="Returned on" optionalLabel errorKeys={["returnedAt"]} hint="Leave empty to use the current time." />
                  <FText name="returnedTime" type="time" label="Returned at" optionalLabel step={60} hint={`In ${timeZoneLabel(r.returnBranch.timezone)}.`} />
                  <FSelect
                    name="returnBranchId"
                    label="Returned to branch"
                    options={branches.map((b) => ({ value: b.id, label: b.name }))}
                    defaultValue={r.returnBranch.id}
                  />
                  <FSelect
                    name="vehicleStatus"
                    label="Car after return"
                    options={[
                      { value: "AVAILABLE", label: "Ready to rent" },
                      { value: "MAINTENANCE", label: "Needs maintenance" },
                    ]}
                    defaultValue="AVAILABLE"
                  />
                  <FMoney name="damageChargeFils" label="Damage charge" optionalLabel hint="Before VAT; taken from the deposit." />
                  <FTextarea name="notes" label="Return notes" optionalLabel rows={3} fieldClassName="sm:col-span-2" />
                </ActionForm>
              </CardBody>
            </Card>
          ) : r.status === "RETURNED" && a ? (
            <Card>
              <CardHeader title="Returned" description={a.checkedInAt ? `Checked in ${formatDateTime(a.checkedInAt, r.returnBranch.timezone)}.` : undefined} />
              <CardBody>
                <dl>
                  <Row label={`Late return (${a.lateDays ?? 0} days)`}>{formatMoney(a.lateFeeFils ?? 0, "AED")}</Row>
                  <Row label="Fuel charge">{formatMoney(a.fuelChargeFils ?? 0, "AED")}</Row>
                  <Row label="Damage charge">{formatMoney(a.damageChargeFils ?? 0, "AED")}</Row>
                  <Row label="VAT on charges">{formatMoney(a.chargesTaxFils ?? 0, "AED")}</Row>
                  <Row label="Taken from deposit" strong>
                    {formatMoney(a.depositCapturedFils ?? 0, "AED")}
                  </Row>
                  {(a.amountDueFils ?? 0) > 0 && <Row label="Above the deposit">{formatMoney(a.amountDueFils ?? 0, "AED")}</Row>}
                  {r.balanceDueFils > 0 && (
                    <Row label="Balance the customer still owes" strong>
                      {formatMoney(r.balanceDueFils, "AED")}
                    </Row>
                  )}
                </dl>
                <Link href={`/admin/damage/new?vehicle=${r.vehicle.id}&reservation=${r.id}`} className="mt-4 inline-block text-sm font-semibold text-brand-800 underline">
                  File a damage report
                </Link>
              </CardBody>
            </Card>
          ) : (
            <Notice tone="warning" title="Can't check in this reservation">
              Only cars that are on rent can be checked in. Current status: {r.status.toLowerCase().replace(/_/g, " ")}.
            </Notice>
          )}
        </div>
      )}

      <section aria-labelledby="onrent-heading">
        <h2 id="onrent-heading" className="mb-3 text-lg font-bold text-ink">
          Cars on rent ({onRent.total})
        </h2>
        {onRent.items.length === 0 ? (
          <p className="text-sm text-ink-muted">No cars are out right now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            {[...onRent.items]
              .sort((x, y) => x.returnAt.getTime() - y.returnAt.getTime())
              .map((t) => (
                <li key={t.id}>
                  <Link href={`/admin/check-in?ref=${t.reference}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-canvas">
                    <span>
                      <span className="font-mono font-semibold text-brand-800">{t.reference}</span> · {t.customer.name} · {t.vehicle.name}
                    </span>
                    <span className="text-ink-muted">
                      Due {formatDateTime(t.returnAt, t.returnBranch.timezone)} · {t.returnBranch.code}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}
