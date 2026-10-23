import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getBranch } from "@/lib/fleet/catalog";

// Existence check above the loading boundary so unknown branches return a real 404 (BUG-009).
export const instant = false;

export default async function BranchLayout({ children, params }: LayoutProps<"/branches/[slug]">) {
  const { slug } = await params;
  try {
    const branch = await getBranch(slug);
    if (!branch.isActive) notFound();
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return children;
}
