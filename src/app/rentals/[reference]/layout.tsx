import { loadMyReservation } from "../_lib/load";

// Sign-in and ownership check above the loading boundary: another customer's reference is a
// real 404 and a signed-out visitor gets a real redirect (BUG-009).
export const instant = false;

export default async function RentalLayout({ children, params }: LayoutProps<"/rentals/[reference]">) {
  const { reference } = await params;
  await loadMyReservation(reference, `/rentals/${encodeURIComponent(reference)}`);
  return children;
}
