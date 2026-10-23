import type { Metadata } from "next";
import { listFleet } from "@/lib/fleet/admin";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../_lib/auth";
import { ActionForm, FMoney, FSelect, FText, FTextarea } from "../../_components/action-form";
import { createDamageAction } from "../actions";

export const metadata: Metadata = { title: "New damage report" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewDamagePage({ searchParams }: PageProps<"/admin/damage/new">) {
  const sp = await searchParams;
  const actor = await requireAdminPage("/admin/damage/new");
  const fleet = await listFleet(actor);
  const vehicleId = typeof sp.vehicle === "string" && UUID.test(sp.vehicle) ? sp.vehicle : "";
  const reservationId = typeof sp.reservation === "string" && UUID.test(sp.reservation) ? sp.reservation : "";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Damage reports", href: "/admin/damage" }, { label: "New" }]}
        title="Report damage"
        description="Photos can be added on the next screen."
      />
      <Card padded>
        <ActionForm action={createDamageAction} submitLabel="Create report" fieldsClassName="sm:grid-cols-2">
          {reservationId && <input type="hidden" name="reservationId" value={reservationId} />}
          <FSelect name="vehicleId" label="Vehicle" required placeholder="Choose" defaultValue={vehicleId} options={fleet.map((v) => ({ value: v.id, label: `${v.make} ${v.model} · ${v.plateNumber}` }))} />
          <FSelect
            name="stage"
            label="Found"
            required
            defaultValue={reservationId ? "RETURN" : "OTHER"}
            options={[
              { value: "PICKUP", label: "At pick-up" },
              { value: "RETURN", label: "At return" },
              { value: "OTHER", label: "Other" },
            ]}
          />
          <FSelect
            name="severity"
            label="Severity"
            required
            defaultValue="MINOR"
            options={[
              { value: "MINOR", label: "Minor" },
              { value: "MODERATE", label: "Moderate" },
              { value: "MAJOR", label: "Major" },
            ]}
          />
          <FText name="location" label="Where on the car" required placeholder="e.g. Rear bumper, left side" />
          <FTextarea name="description" label="Description" required rows={4} fieldClassName="sm:col-span-2" />
          <FMoney name="estimatedCostFils" label="Estimated repair cost" optionalLabel />
        </ActionForm>
      </Card>
    </>
  );
}
