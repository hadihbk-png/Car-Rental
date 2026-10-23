import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getDamageReport } from "@/lib/reservations/damage";
import { requireAdminPage } from "../../_lib/auth";

// Admin + existence check above the loading boundary for a real 404 (BUG-009).
export const instant = false;

export default async function AdminDamageLayout({ children, params }: LayoutProps<"/admin/damage/[id]">) {
  const { id } = await params;
  const actor = await requireAdminPage(`/admin/damage/${id}`);
  try {
    await getDamageReport(actor, id);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  return children;
}
