import "server-only";
import { notFound } from "next/navigation";
import { requireUserOrRedirect, type Actor } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getReservation, type ReservationView } from "@/lib/reservations";

/** Signed-in user's reservation by reference; other users' reservations are NOT_FOUND (404). */
export async function loadMyReservation(reference: string, path: string): Promise<{ actor: Actor; r: ReservationView }> {
  const actor = await requireUserOrRedirect(path);
  try {
    return { actor, r: await getReservation(actor, reference) };
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
