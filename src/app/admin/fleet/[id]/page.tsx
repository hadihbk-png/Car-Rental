import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { getFleetVehicle, listMaintenanceBlocks, VEHICLE_PHOTO_TYPES } from "@/lib/fleet/admin";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { formatDateTime, timeZoneLabel } from "@/lib/ui/datetime";
import { formatBytes } from "@/lib/ui/files";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { requireAdminPage } from "../../_lib/auth";
import { ActionForm, FFile, FText } from "../../_components/action-form";
import { vehicleFormOptions } from "../_lib";
import { createMaintenanceAction, deleteMaintenanceAction, removePhotoAction, updateVehicleAction, uploadPhotoAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

export const metadata: Metadata = { title: "Vehicle" };

export default async function AdminVehiclePage({ params, searchParams }: PageProps<"/admin/fleet/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const actor = await requireAdminPage(`/admin/fleet/${id}`);
  let vehicle;
  try {
    vehicle = await getFleetVehicle(actor, id);
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }
  const [options, blocks] = await Promise.all([vehicleFormOptions(), listMaintenanceBlocks(actor, { vehicleId: vehicle.id })]);
  const tz = options.timeZones[vehicle.branchId] ?? "UTC";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Fleet", href: "/admin/fleet" }, { label: vehicle.plateNumber }]}
        eyebrow={<span className="font-mono">{vehicle.plateNumber}</span>}
        title={`${vehicle.make} ${vehicle.model} ${vehicle.year}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="vehicle" status={vehicle.status} /> {vehicle.branchName} · {vehicle.categoryName}
          </span>
        }
        actions={
          vehicle.status !== "RETIRED" && (
            <Link href={`/vehicles/${vehicle.id}`} className={buttonClasses("outline")}>
              View public page
            </Link>
          )
        }
      />
      {sp.created && (
        <Notice tone="success" className="mb-4" live>
          Vehicle created. Add photos and a pricing rule so customers can book it.
        </Notice>
      )}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <VehicleForm
              action={updateVehicleAction.bind(null, vehicle.id)}
              vehicle={vehicle}
              branches={options.branches}
              categories={options.categories}
              features={options.features}
              submitLabel="Save vehicle"
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Photos" description="The first photo is the main one shown to customers." />
          <CardBody className="flex flex-col gap-6">
            {vehicle.photoUrls.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {vehicle.photoUrls.map((url, i) => (
                  <li key={url} className="overflow-hidden rounded-xl border border-line">
                    <div className="relative aspect-[16/10] bg-surface-muted">
                      <Image src={url} alt={`Photo ${i + 1}`} fill sizes="(min-width: 1024px) 300px, 50vw" className="object-cover" />
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2">
                      <span className="text-sm text-ink-muted">{i === 0 ? "Main photo" : `Photo ${i + 1}`}</span>
                      <ActionForm action={removePhotoAction.bind(null, vehicle.id, i)} submitLabel="Remove" submitVariant="ghost" pendingLabel="Removing…" confirmMessage="Remove this photo?" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No photos yet.</p>
            )}
            <ActionForm action={uploadPhotoAction.bind(null, vehicle.id)} submitLabel="Upload photo" pendingLabel="Uploading…" idPrefix="photo-">
              <FFile
                name="photo"
                label="Add a photo"
                accept={VEHICLE_PHOTO_TYPES}
                maxBytes={MAX_UPLOAD_BYTES}
                hint={`JPG, PNG or WebP, up to ${formatBytes(MAX_UPLOAD_BYTES)}. Landscape 16:10 works best.`}
              />
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Maintenance" description={`Blocks stop bookings for the period. Times in ${timeZoneLabel(tz)}.`} />
          <CardBody className="flex flex-col gap-6">
            <DataTable
              caption="Upcoming maintenance"
              rows={blocks}
              getRowKey={(b) => b.id}
              empty={<p className="text-sm text-ink-muted">No upcoming maintenance.</p>}
              columns={[
                { key: "reason", header: "Reason", cell: (b) => b.reason },
                { key: "start", header: "From", cell: (b) => formatDateTime(b.startsAt, b.timezone) },
                { key: "end", header: "Until", cell: (b) => formatDateTime(b.endsAt, b.timezone) },
                {
                  key: "actions",
                  header: "Actions",
                  srOnlyHeader: true,
                  align: "right",
                  cell: (b) => (
                    <ActionForm action={deleteMaintenanceAction.bind(null, b.id)} submitLabel="Remove" submitVariant="ghost" pendingLabel="Removing…" confirmMessage="Remove this maintenance block?" />
                  ),
                },
              ]}
            />
            <ActionForm action={createMaintenanceAction.bind(null, vehicle.id)} submitLabel="Add maintenance block" idPrefix="mb-" resetOnSuccess fieldsClassName="sm:grid-cols-2 lg:grid-cols-4">
              <FText name="startDate" type="date" label="Start date" required errorKeys={["startsAt"]} />
              <FText name="startTime" type="time" label="Start time" required step={1800} defaultValue="09:00" />
              <FText name="endDate" type="date" label="End date" required errorKeys={["endsAt"]} />
              <FText name="endTime" type="time" label="End time" required step={1800} defaultValue="18:00" />
              <FText name="reason" label="Reason" required placeholder="e.g. 20,000 km service" fieldClassName="sm:col-span-2 lg:col-span-4" />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
