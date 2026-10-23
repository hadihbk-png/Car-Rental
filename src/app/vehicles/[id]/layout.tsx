import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getVehicle } from "@/lib/fleet/catalog";

// The existence check runs here, above this segment's loading boundary, so an unknown
// vehicle gets a real HTTP 404 before anything streams (BUG-009). Found vehicles still
// stream the page behind loading.tsx.
export const instant = false;

export default async function VehicleLayout({ children, params }: LayoutProps<"/vehicles/[id]">) {
  const { id } = await params;
  try {
    await getVehicle(id);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return children;
}
