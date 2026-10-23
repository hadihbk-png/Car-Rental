import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { DAMAGE_IMAGE_TYPES, getDamageReport } from "@/lib/reservations/damage";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { formatDateTime } from "@/lib/ui/datetime";
import { formatBytes } from "@/lib/ui/files";
import { formatMoney } from "@/lib/ui/money";
import { defaultTimeZone } from "@/app/_lib/trip";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminPage } from "../../_lib/auth";
import { ActionForm, FCheckbox, FFile, FMoney, FSelect, FText, FTextarea } from "../../_components/action-form";
import { addDamageImageAction, updateDamageAction } from "../actions";
import { SEVERITY_TONE, STAGE_LABEL } from "../_lib";

export const metadata: Metadata = { title: "Damage report" };

export default async function DamageReportPage({ params, searchParams }: PageProps<"/admin/damage/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdminPage(`/admin/damage/${id}`);
  let d;
  try {
    d = await getDamageReport(actor, id);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  const tz = await defaultTimeZone();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Damage reports", href: "/admin/damage" }, { label: d.location }]}
        eyebrow={`${d.vehicleName} · ${d.plateNumber}`}
        title={d.location}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{d.severity.toLowerCase()}</Badge>
            {STAGE_LABEL[d.stage]} · reported {formatDateTime(d.createdAt, tz)}
            {d.reservationReference && (
              <>
                {" · "}
                <Link href={`/admin/reservations/${d.reservationReference}`} className="font-mono text-brand-800 underline">
                  {d.reservationReference}
                </Link>
              </>
            )}
            {d.resolvedAt ? <Badge tone="success" dot>Resolved</Badge> : <Badge tone="warning" dot>Open</Badge>}
          </span>
        }
      />
      {sp.created && (
        <Notice tone="success" className="mb-4" live>
          Report created. Add photos below.
        </Notice>
      )}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Photos" description="Only staff can see these photos." />
          <CardBody className="flex flex-col gap-6">
            {d.imageUrls.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {d.imageUrls.map((url, i) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface-muted">
                      {/* Private, cookie-authorised file: served as-is, not through the public image optimizer. */}
                      <Image src={url} alt={`Damage photo ${i + 1}: ${d.location}`} fill unoptimized className="object-cover" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No photos yet.</p>
            )}
            <ActionForm action={addDamageImageAction.bind(null, d.id)} submitLabel="Upload photo" pendingLabel="Uploading…" idPrefix="img-">
              <FFile name="image" label="Add a photo" accept={DAMAGE_IMAGE_TYPES} maxBytes={MAX_UPLOAD_BYTES} hint={`JPG, PNG or WebP, up to ${formatBytes(MAX_UPLOAD_BYTES)}.`} />
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" description={`Estimated cost: ${formatMoney(d.estimatedCostFils, "AED")}`} />
          <CardBody>
            <ActionForm action={updateDamageAction.bind(null, d.id)} submitLabel="Save report" fieldsClassName="sm:grid-cols-2">
              <FSelect
                name="severity"
                label="Severity"
                required
                defaultValue={d.severity}
                options={[
                  { value: "MINOR", label: "Minor" },
                  { value: "MODERATE", label: "Moderate" },
                  { value: "MAJOR", label: "Major" },
                ]}
              />
              <FText name="location" label="Where on the car" required defaultValue={d.location} />
              <FTextarea name="description" label="Description" required rows={4} defaultValue={d.description} fieldClassName="sm:col-span-2" />
              <FMoney name="estimatedCostFils" label="Estimated repair cost" defaultValue={formatMoney(d.estimatedCostFils, "AED", { showCurrency: false })} />
              <FCheckbox name="resolved" label="Resolved (repaired or settled)" defaultChecked={Boolean(d.resolvedAt)} />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
