import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../_lib/auth";
import { vehicleFormOptions } from "../_lib";
import { createVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

export const metadata: Metadata = { title: "New vehicle" };

export default async function NewVehiclePage() {
  await requireAdminPage("/admin/fleet/new");
  const { branches, categories, features } = await vehicleFormOptions();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Fleet", href: "/admin/fleet" }, { label: "New vehicle" }]}
        title="Add a vehicle"
        description="Photos and maintenance blocks can be added after saving."
      />
      <Card padded>
        <VehicleForm action={createVehicleAction} branches={branches} categories={categories} features={features} submitLabel="Create vehicle" />
      </Card>
    </>
  );
}
