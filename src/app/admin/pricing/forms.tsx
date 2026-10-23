import { formatMoney } from "@/lib/ui/money";
import type { ActionState } from "@/app/_lib/action-state";
import { ActionForm, FCheckbox, FMoney, FSelect, FText, FTextarea } from "../_components/action-form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Option = { value: string; label: string };

const aed = (fils: number | null | undefined) => (fils === null || fils === undefined ? "" : formatMoney(fils, "AED", { showCurrency: false }));

export interface RuleValues {
  name: string;
  categoryId: string | null;
  vehicleId: string | null;
  branchId: string | null;
  dailyRateFils: number;
  minDays: number;
  maxDays: number | null;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  isActive: boolean;
}

export function RuleForm({
  action,
  rule,
  categories,
  vehicles,
  branches,
  submitLabel,
}: {
  action: Action;
  rule?: RuleValues;
  categories: Option[];
  vehicles: Option[];
  branches: Option[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} fieldsClassName="sm:grid-cols-2">
      <FText name="name" label="Rule name" required defaultValue={rule?.name} fieldClassName="sm:col-span-2" hint='e.g. "SUV weekly rate" or "Eid peak season".' />
      <FSelect name="categoryId" label="Car category" placeholder="Any (use a vehicle)" options={categories} defaultValue={rule?.categoryId ?? ""} hint="Choose a category or a single vehicle." />
      <FSelect name="vehicleId" label="Single vehicle" placeholder="None" options={vehicles} defaultValue={rule?.vehicleId ?? ""} hint="Overrides category rules for this car." />
      <FSelect name="branchId" label="Branch" placeholder="All branches" options={branches} defaultValue={rule?.branchId ?? ""} />
      <FMoney name="dailyRateFils" label="Daily rate" required defaultValue={aed(rule?.dailyRateFils)} hint="Before VAT." />
      <FText name="minDays" label="Minimum rental days" type="number" inputMode="numeric" min={1} required defaultValue={rule?.minDays ?? 1} />
      <FText name="maxDays" label="Maximum rental days" type="number" inputMode="numeric" min={1} optionalLabel defaultValue={rule?.maxDays ?? ""} />
      <FText name="validFrom" label="Valid from (pick-up date)" type="date" optionalLabel defaultValue={rule?.validFrom ?? ""} />
      <FText name="validTo" label="Valid to (pick-up date)" type="date" optionalLabel defaultValue={rule?.validTo ?? ""} />
      <FText name="priority" label="Priority" type="number" inputMode="numeric" required defaultValue={rule?.priority ?? 0} hint="Higher wins when two rules match equally." />
      <FCheckbox name="isActive" label="Active" defaultChecked={rule?.isActive ?? true} />
    </ActionForm>
  );
}

export interface ExtraValues {
  code: string;
  name: string;
  description: string | null;
  pricingType: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxPriceFils: number | null;
  maxQuantity: number;
  isActive: boolean;
  /** Not returned by listExtras; the field is only shown when known (create form). */
  sortOrder?: number;
}

export function ExtraForm({ action, extra, submitLabel }: { action: Action; extra?: ExtraValues; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} fieldsClassName="sm:grid-cols-2">
      <FText name="name" label="Name" required defaultValue={extra?.name} />
      <FText name="code" label="Code" required hint="Capitals, digits and _, e.g. CHILD_SEAT." defaultValue={extra?.code} />
      <FTextarea name="description" label="Description" optionalLabel rows={2} defaultValue={extra?.description ?? ""} fieldClassName="sm:col-span-2" />
      <FSelect
        name="pricingType"
        label="Pricing"
        required
        options={[
          { value: "PER_DAY", label: "Per day" },
          { value: "PER_RENTAL", label: "Once per rental" },
        ]}
        defaultValue={extra?.pricingType ?? "PER_DAY"}
      />
      <FMoney name="priceFils" label="Price" required defaultValue={aed(extra?.priceFils)} hint="Before VAT." />
      <FMoney name="maxPriceFils" label="Maximum per rental" optionalLabel defaultValue={aed(extra?.maxPriceFils)} hint="Caps per-day pricing for long rentals." />
      <FText name="maxQuantity" label="Maximum quantity" type="number" inputMode="numeric" min={1} max={10} required defaultValue={extra?.maxQuantity ?? 1} />
      {(!extra || extra.sortOrder !== undefined) && (
        <FText name="sortOrder" label="Sort order" type="number" inputMode="numeric" defaultValue={extra?.sortOrder ?? 0} hint="Lower numbers are listed first." />
      )}
      <FCheckbox name="isActive" label="Offered to customers" defaultChecked={extra?.isActive ?? true} />
    </ActionForm>
  );
}
