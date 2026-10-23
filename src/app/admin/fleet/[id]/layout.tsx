import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getFleetVehicle } from "@/lib/fleet/admin";
import { requireAdminPage } from "../../_lib/auth";

// Admin + existence check above the loading boundary for a real 404 (BUG-009).
export const instant = false;

export default async function AdminVehicleLayout({ children, params }: LayoutProps<"/admin/fleet/[id]">) {
  const { id } = await params;
  const actor = await requireAdminPage(`/admin/fleet/${id}`);
  try {
    await getFleetVehicle(actor, id);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  return children;
}
