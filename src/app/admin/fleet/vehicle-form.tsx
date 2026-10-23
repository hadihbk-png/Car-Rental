import type { ActionState } from "@/app/_lib/action-state";
import { FUEL_OPTIONS, TRANSMISSION_OPTIONS } from "@/lib/ui/labels";
import { statusPresentation } from "@/components/ui/badge";
import { ChoiceGroup } from "@/components/ui/form-controls";
import { ActionForm, FCheckbox, FSelect, FText, FTextarea } from "../_components/action-form";

type Option = { value: string; label: string };

export const VEHICLE_STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"] as const;

export interface VehicleValues {
  branchId: string;
  categoryId: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin: string;
  color: string | null;
  transmission: string;
  fuelType: string;
  seats: number;
  doors: number;
  luggage: number;
  mileageKm: number;
  status: string;
  description: string | null;
  featureIds: string[];
}

export function VehicleForm({
  action,
  vehicle,
  branches,
  categories,
  features,
  submitLabel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  vehicle?: VehicleValues;
  branches: Option[];
  categories: Option[];
  features: Option[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} fieldsClassName="sm:grid-cols-2 lg:grid-cols-3">
      <FText name="make" label="Make" required defaultValue={vehicle?.make} />
      <FText name="model" label="Model" required defaultValue={vehicle?.model} />
      <FText name="year" label="Year" type="number" inputMode="numeric" required defaultValue={vehicle?.year} />
      <FText name="plateNumber" label="Plate number" required defaultValue={vehicle?.plateNumber} />
      <FText name="vin" label="VIN" required hint="17 characters, no I, O or Q." defaultValue={vehicle?.vin} />
      <FText name="color" label="Colour" optionalLabel defaultValue={vehicle?.color ?? ""} />
      <FSelect name="branchId" label="Home branch" required placeholder="Choose" options={branches} defaultValue={vehicle?.branchId ?? ""} />
      <FSelect name="categoryId" label="Category" required placeholder="Choose" options={categories} defaultValue={vehicle?.categoryId ?? ""} />
      <FSelect
        name="status"
        label="Status"
        required
        options={VEHICLE_STATUSES.map((s) => ({ value: s, label: statusPresentation("vehicle", s).label }))}
        defaultValue={vehicle?.status ?? "AVAILABLE"}
        hint="Retired cars are hidden; maintenance cars can't be booked."
      />
      <FSelect name="transmission" label="Transmission" required options={TRANSMISSION_OPTIONS} defaultValue={vehicle?.transmission ?? "AUTOMATIC"} />
      <FSelect name="fuelType" label="Fuel" required options={FUEL_OPTIONS} defaultValue={vehicle?.fuelType ?? "PETROL"} />
      <FText name="seats" label="Seats" type="number" inputMode="numeric" min={1} max={15} required defaultValue={vehicle?.seats ?? 5} />
      <FText name="doors" label="Doors" type="number" inputMode="numeric" min={2} max={6} required defaultValue={vehicle?.doors ?? 4} />
      <FText name="luggage" label="Bags" type="number" inputMode="numeric" min={0} max={10} required defaultValue={vehicle?.luggage ?? 2} />
      <FText name="mileageKm" label="Mileage (km)" type="number" inputMode="numeric" min={0} required defaultValue={vehicle?.mileageKm ?? 0} />
      <FTextarea name="description" label="Description" optionalLabel rows={3} defaultValue={vehicle?.description ?? ""} fieldClassName="sm:col-span-2 lg:col-span-3" />
      {features.length > 0 && (
        <div className="sm:col-span-2 lg:col-span-3">
          <ChoiceGroup legend="Features">
            <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feat) => (
                <FCheckbox key={feat.value} name="featureIds" value={feat.value} label={feat.label} defaultChecked={vehicle?.featureIds.includes(feat.value)} errorKeys={[]} />
              ))}
            </div>
          </ChoiceGroup>
        </div>
      )}
    </ActionForm>
  );
}
