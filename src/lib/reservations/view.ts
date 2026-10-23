import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  branches,
  extras,
  rentalAgreements,
  reservationExtras,
  reservations,
  users,
  type RentalAgreement,
  type Reservation,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/types";
import { DomainError } from "@/lib/errors";
import { loadVehicleCards, toBranchSummary, type BranchSummary, type VehicleCard } from "@/lib/fleet/catalog";
import { canModifyDates, cancellationOutcome, type CancellationOutcome } from "@/lib/pricing/calc";
import { moneySummary } from "./money";

export type ReservationExtraLine = {
  extraId: string;
  code: string;
  name: string;
  pricingType: "PER_DAY" | "PER_RENTAL";
  quantity: number;
  unitPriceFils: number;
  totalFils: number;
};

export type ReservationView = {
  id: string;
  reference: string;
  status: Reservation["status"];
  /** Status of the rental payment, kept separately from the reservation status. */
  paymentStatus: "pending" | "succeeded" | "failed" | "canceled" | "refunded" | "partially_refunded" | null;
  depositStatus: "pending" | "held" | "released" | "captured" | "failed" | null;
  holdExpiresAt: Date | null;
  pickupAt: Date;
  returnAt: Date;
  /** Pick-up branch time zone; render pickupAt in it (returnAt in returnBranch.timezone). */
  timezone: string;
  vehicle: VehicleCard;
  pickupBranch: BranchSummary;
  returnBranch: BranchSummary;
  price: {
    currency: "AED";
    dailyRateFils: number;
    rentalDays: number;
    rentalFils: number;
    extras: ReservationExtraLine[];
    extrasFils: number;
    oneWayFeeFils: number;
    vatRateBps: number;
    taxFils: number;
    totalFils: number;
    depositFils: number;
  };
  /** Net amount paid (payments minus refunds). */
  paidFils: number;
  cancellationFeeFils: number | null;
  refundedFils: number;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  /** Return charges above the deposit still owed (pay with payReturnBalance). */
  balanceDueFils: number;
  can: { pay: boolean; cancel: boolean; modifyDates: boolean; viewVoucher: boolean; payBalance: boolean };
  /** What cancelling now would cost (only when cancel is allowed). */
  cancellationPreview: CancellationOutcome | null;
  customer: { id: string; name: string; email: string };
  agreement: Pick<
    RentalAgreement,
    | "checkedOutAt"
    | "pickupMileageKm"
    | "pickupFuelLevel"
    | "pickupNotes"
    | "checkedInAt"
    | "returnMileageKm"
    | "returnFuelLevel"
    | "returnNotes"
    | "lateDays"
    | "lateFeeFils"
    | "fuelChargeFils"
    | "damageChargeFils"
    | "chargesTaxFils"
    | "depositCapturedFils"
    | "amountDueFils"
  > | null;
};

export function assertCanAccess(actor: Actor, r: Pick<Reservation, "userId">) {
  if (actor.role !== "admin" && r.userId !== actor.id) {
    // Same answer as a missing reservation: do not reveal that it exists.
    throw new DomainError("NOT_FOUND", "Reservation not found.");
  }
}

export async function loadReservationRow(tx: DbOrTx, idOrReference: string, forUpdate = false): Promise<Reservation> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrReference);
  if (!isUuid && !/^DE-[A-Z0-9]{6}$/.test(idOrReference)) throw new DomainError("NOT_FOUND", "Reservation not found.");
  const q = tx
    .select()
    .from(reservations)
    .where(isUuid ? eq(reservations.id, idOrReference) : eq(reservations.reference, idOrReference));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw new DomainError("NOT_FOUND", "Reservation not found.");
  return row;
}

export async function buildReservationViews(rows: Reservation[], now: Date = new Date()): Promise<ReservationView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const cards = await loadVehicleCards([...new Set(rows.map((r) => r.vehicleId))]);
  const branchRows = await db
    .select()
    .from(branches)
    .where(inArray(branches.id, [...new Set(rows.flatMap((r) => [r.pickupBranchId, r.returnBranchId]))]));
  const extraRows = await db
    .select({ re: reservationExtras, code: extras.code, name: extras.name })
    .from(reservationExtras)
    .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
    .where(inArray(reservationExtras.reservationId, ids));
  const userRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]));
  const agreements = await db.select().from(rentalAgreements).where(inArray(rentalAgreements.reservationId, ids));

  const views: ReservationView[] = [];
  for (const r of rows) {
    const money = await moneySummary(db, r.id);
    const pickupBranch = branchRows.find((b) => b.id === r.pickupBranchId)!;
    const returnBranch = branchRows.find((b) => b.id === r.returnBranchId)!;
    const holdLive = r.status === "PENDING" && !!r.holdExpiresAt && r.holdExpiresAt > now;
    const cancellable = r.status === "PENDING" || (r.status === "CONFIRMED" && now < r.pickupAt);
    const preview =
      r.status === "CONFIRMED" && cancellable
        ? cancellationOutcome({ pickupAt: r.pickupAt, now, paidFils: money.paidFils, dailyRateFils: r.dailyRateFils, vatRateBps: r.vatRateBps })
        : r.status === "PENDING"
          ? ({ allowed: true, free: true, feeFils: 0, refundFils: 0 } as const)
          : null;
    const ag = agreements.find((a) => a.reservationId === r.id);
    const returnPaid = money.payments
      .filter((p) => p.purpose === "RETURN_CHARGES" && (p.status === "succeeded" || p.status === "partially_refunded" || p.status === "refunded"))
      .reduce((sum, p) => sum + p.amountFils - p.amountRefundedFils, 0);
    const balanceDueFils = ag ? Math.max(0, ag.amountDueFils - returnPaid) : 0;
    views.push({
      id: r.id,
      reference: r.reference,
      status: r.status,
      paymentStatus: money.rentalPaymentStatus,
      depositStatus: money.depositStatus,
      holdExpiresAt: r.status === "PENDING" ? r.holdExpiresAt : null,
      pickupAt: r.pickupAt,
      returnAt: r.returnAt,
      timezone: pickupBranch.timezone,
      vehicle: cards.find((c) => c.id === r.vehicleId)!,
      pickupBranch: toBranchSummary(pickupBranch),
      returnBranch: toBranchSummary(returnBranch),
      price: {
        currency: "AED",
        dailyRateFils: r.dailyRateFils,
        rentalDays: r.rentalDays,
        rentalFils: r.rentalFils,
        extras: extraRows
          .filter((e) => e.re.reservationId === r.id)
          .map((e) => ({
            extraId: e.re.extraId,
            code: e.code,
            name: e.name,
            pricingType: e.re.pricingType,
            quantity: e.re.quantity,
            unitPriceFils: e.re.unitPriceFils,
            totalFils: e.re.totalFils,
          })),
        extrasFils: r.extrasFils,
        oneWayFeeFils: r.oneWayFeeFils,
        vatRateBps: r.vatRateBps,
        taxFils: r.taxFils,
        totalFils: r.totalFils,
        depositFils: r.depositFils,
      },
      paidFils: money.paidFils,
      cancellationFeeFils: r.cancellationFeeFils,
      refundedFils: r.refundedFils,
      confirmedAt: r.confirmedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
      can: {
        pay: holdLive,
        cancel: !!preview?.allowed,
        // BUG-008: only CONFIRMED reservations can change dates (finish or cancel payment first).
        modifyDates: r.status === "CONFIRMED" && canModifyDates(r.pickupAt, now),
        viewVoucher: r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED",
        payBalance: r.status === "RETURNED" && balanceDueFils > 0,
      },
      balanceDueFils,
      cancellationPreview: preview,
      customer: userRows.find((u) => u.id === r.userId)!,
      agreement: ag
        ? {
            checkedOutAt: ag.checkedOutAt,
            pickupMileageKm: ag.pickupMileageKm,
            pickupFuelLevel: ag.pickupFuelLevel,
            pickupNotes: ag.pickupNotes,
            checkedInAt: ag.checkedInAt,
            returnMileageKm: ag.returnMileageKm,
            returnFuelLevel: ag.returnFuelLevel,
            returnNotes: ag.returnNotes,
            lateDays: ag.lateDays,
            lateFeeFils: ag.lateFeeFils,
            fuelChargeFils: ag.fuelChargeFils,
            damageChargeFils: ag.damageChargeFils,
            chargesTaxFils: ag.chargesTaxFils,
            depositCapturedFils: ag.depositCapturedFils,
            amountDueFils: ag.amountDueFils,
          }
        : null,
    });
  }
  return views;
}

export async function buildReservationView(row: Reservation, now: Date = new Date()): Promise<ReservationView> {
  const [view] = await buildReservationViews([row], now);
  return view;
}
