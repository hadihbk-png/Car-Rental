import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getBranch } from "@/lib/fleet/catalog";
import { requireAdminPage } from "../../_lib/auth";

// Admin + existence check above the loading boundary for a real 404 (BUG-009).
export const instant = false;

export default async function AdminBranchLayout({ children, params }: LayoutProps<"/admin/branches/[id]">) {
  const { id } = await params;
  await requireAdminPage(`/admin/branches/${id}`);
  try {
    await getBranch(id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return children;
}
