import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getReservation } from "@/lib/reservations";
import { requireAdminPage } from "../../_lib/auth";

// Admin + existence check above the loading boundary for a real 404 (BUG-009).
export const instant = false;

export default async function AdminReservationLayout({ children, params }: LayoutProps<"/admin/reservations/[reference]">) {
  const { reference } = await params;
  const actor = await requireAdminPage(`/admin/reservations/${encodeURIComponent(reference)}`);
  try {
    await getReservation(actor, reference);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  return children;
}
