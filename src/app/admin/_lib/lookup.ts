import "server-only";
import type { Actor } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getReservation, verifyVoucherPayload, type ReservationView } from "@/lib/reservations";
import { cleanMessage } from "@/app/_lib/action-errors";

/** Finds a reservation by reference/id or a scanned voucher payload ("DE1.<ref>.<sig>"). */
export async function lookupReservation(actor: Actor, value: string): Promise<{ r: ReservationView | null; error: string | null }> {
  const v = value.trim();
  if (!v) return { r: null, error: null };
  try {
    const r = v.startsWith("DE1.") ? await verifyVoucherPayload(actor, v) : await getReservation(actor, v.toUpperCase());
    return { r, error: null };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { r: null, error: error.code === "NOT_FOUND" ? `No reservation found for "${v}".` : cleanMessage(error.message) };
  }
}
