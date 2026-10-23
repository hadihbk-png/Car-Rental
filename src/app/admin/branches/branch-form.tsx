import type { BranchSummary } from "@/lib/fleet/catalog";
import type { ActionState } from "@/app/_lib/action-state";
import { ActionForm, FCheckbox, FText } from "../_components/action-form";

/** Create/edit branch form. `defaultTimeZone` pre-fills new branches. */
export function BranchForm({
  action,
  branch,
  defaultTimeZone,
  submitLabel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  branch?: BranchSummary;
  defaultTimeZone: string;
  submitLabel: string;
}) {
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <ActionForm action={action} submitLabel={submitLabel} fieldsClassName="sm:grid-cols-2">
      <FText name="name" label="Branch name" required defaultValue={branch?.name} />
      <FText name="city" label="City" required defaultValue={branch?.city} />
      <FText name="code" label="Branch code" required hint="2–10 capital letters or digits, e.g. DXBAPT." defaultValue={branch?.code} />
      <FText name="slug" label="URL name" required hint="Lowercase and dashes, e.g. dubai-airport." defaultValue={branch?.slug} />
      <FText name="address" label="Address" required defaultValue={branch?.address} fieldClassName="sm:col-span-2" />
      <FText name="phone" type="tel" label="Phone" optionalLabel defaultValue={branch?.phone ?? ""} />
      <FText name="email" type="email" label="Email" optionalLabel defaultValue={branch?.email ?? ""} />
      <FText
        name="timezone"
        label="Time zone"
        required
        list="tz-list"
        hint="IANA name, e.g. Asia/Dubai. All times at this branch are shown in it."
        defaultValue={branch?.timezone ?? defaultTimeZone}
      />
      <datalist id="tz-list">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <FText name="openingHours" label="Opening hours" optionalLabel hint='e.g. "Daily 08:00-22:00" or "Open 24 hours".' defaultValue={branch?.openingHours ?? ""} />
      <FText name="latitude" label="Latitude" optionalLabel inputMode="decimal" defaultValue={branch?.latitude ?? ""} />
      <FText name="longitude" label="Longitude" optionalLabel inputMode="decimal" defaultValue={branch?.longitude ?? ""} />
      <FCheckbox name="isActive" label="Open for bookings" description="Inactive branches are hidden from customers." defaultChecked={branch?.isActive ?? true} />
    </ActionForm>
  );
}
