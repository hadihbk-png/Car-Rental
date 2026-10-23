import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireUserOrRedirect, type Actor } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getVehicle, listBranches, type BranchSummary, type VehicleCard } from "@/lib/fleet/catalog";
import { getQuote, type QuoteResult } from "@/lib/pricing/quote";
import { bookingQuery, parseBookingParams, type BookingParams } from "@/lib/ui/booking-params";
import { zonedTimeToUtc } from "@/lib/ui/datetime";
import type { RawSearchParams } from "@/lib/ui/search-params";
import { cleanMessage } from "@/app/_lib/action-errors";

export interface BookingContext {
  actor: Actor;
  vehicle: VehicleCard;
  booking: BookingParams;
  /** Query string carrying vehicle + trip + extras ("?vehicle=..."). */
  query: string;
  pickupBranch: BranchSummary;
  returnBranch: BranchSummary;
  pickupAt: Date;
  returnAt: Date;
  quote: QuoteResult | null;
  quoteError: string | null;
  /** Vehicle page with the same selection (to change dates or extras). */
  vehiclePageHref: string;
}

/**
 * Validates the booking URL for a flow step: vehicle exists, trip is complete, user is signed in.
 * Redirects to the right place when something is missing, and loads the server quote.
 */
export async function loadBookingContext(searchParams: RawSearchParams, stepPath: string): Promise<BookingContext> {
  const booking = parseBookingParams(searchParams);
  if (!booking.vehicleId) redirect("/search");

  let vehicle: VehicleCard;
  try {
    vehicle = await getVehicle(booking.vehicleId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const t = booking.trip;
  const query = bookingQuery({
    vehicleId: vehicle.id,
    trip: { ...t, pickupBranch: vehicle.branch.slug },
    extras: booking.extras,
  });
  const vehiclePageHref = `/vehicles/${vehicle.id}${query.replace(/^\?vehicle=[^&]*&?/, "?").replace(/\?$/, "")}`;
  if (!t.pickupDate || !t.pickupTime || !t.returnDate || !t.returnTime) redirect(vehiclePageHref);

  const actor = await requireUserOrRedirect(`${stepPath}${query}`);
  const branches = await listBranches();
  const pickupBranch = branches.find((b) => b.id === vehicle.branch.id);
  if (!pickupBranch) notFound();
  const returnBranch = (t.returnBranch && branches.find((b) => b.slug === t.returnBranch)) || pickupBranch;
  const pickupAt = zonedTimeToUtc(t.pickupDate, t.pickupTime, pickupBranch.timezone);
  const returnAt = zonedTimeToUtc(t.returnDate, t.returnTime, pickupBranch.timezone);

  let quote: QuoteResult | null = null;
  let quoteError: string | null = null;
  try {
    quote = await getQuote({
      vehicleId: vehicle.id,
      pickupBranchId: pickupBranch.id,
      returnBranchId: returnBranch.id,
      pickupAt,
      returnAt,
      extras: booking.extras,
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    quoteError = cleanMessage(error.message);
  }

  return { actor, vehicle, booking, query, pickupBranch, returnBranch, pickupAt, returnAt, quote, quoteError, vehiclePageHref };
}
