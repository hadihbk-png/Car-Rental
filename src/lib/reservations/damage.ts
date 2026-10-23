import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { damageReports, rentalAgreements, reservations, vehicles, type DamageReport } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { assertMagicBytes } from "@/lib/drivers";
import { DomainError } from "@/lib/errors";
import { getFileStorage } from "@/lib/storage";
import { contentTypeOf, extensionFor, MAX_UPLOAD_BYTES } from "@/lib/storage/types";
import { parseInput, zFils, zId } from "@/lib/validation";

export const DAMAGE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DAMAGE_IMAGE_MAX_BYTES = MAX_UPLOAD_BYTES;

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new DomainError("FORBIDDEN", "Administrator access required.");
}

export type DamageReportView = Omit<DamageReport, "imageKeys"> & {
  vehicleName: string;
  plateNumber: string;
  reservationReference: string | null;
  /** Authorised admin-only URLs: /api/files/damage/<reportId>/<index>. */
  imageUrls: string[];
};

function toView(d: DamageReport, extra: { vehicleName: string; plateNumber: string; reservationReference: string | null }): DamageReportView {
  const { imageKeys, ...rest } = d;
  return { ...rest, ...extra, imageUrls: imageKeys.map((_, i) => `/api/files/damage/${d.id}/${i}`) };
}

export const createDamageReportSchema = z.object({
  vehicleId: zId,
  reservationId: zId.optional(),
  stage: z.enum(["PICKUP", "RETURN", "OTHER"]),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  location: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(4000),
  estimatedCostFils: zFils.default(0),
});

/** Admin: file a damage report (images are added with addDamageImage). */
export async function createDamageReport(actor: Actor, input: z.input<typeof createDamageReportSchema>): Promise<DamageReportView> {
  assertAdmin(actor);
  const data = parseInput(createDamageReportSchema, input);
  let agreementId: string | null = null;
  if (data.reservationId) {
    const [r] = await db.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, data.reservationId));
    if (!r) throw new DomainError("NOT_FOUND", "Reservation not found.");
    if (r.vehicleId !== data.vehicleId) throw new DomainError("VALIDATION", "The reservation is for a different vehicle.");
    const [ag] = await db.select({ id: rentalAgreements.id }).from(rentalAgreements).where(eq(rentalAgreements.reservationId, data.reservationId));
    agreementId = ag?.id ?? null;
  }
  const [row] = await db
    .insert(damageReports)
    .values({ ...data, reservationId: data.reservationId ?? null, rentalAgreementId: agreementId, reportedBy: actor.id })
    .returning();
  await audit({ actor, action: "damage_report.created", entityType: "damage_report", entityId: row.id, data: { vehicleId: row.vehicleId, severity: row.severity } });
  return (await loadViews(eq(damageReports.id, row.id)))[0];
}

/** Admin: attach a photo (private storage). */
export async function addDamageImage(
  actor: Actor,
  reportId: string,
  file: { data: Uint8Array; contentType: string },
): Promise<DamageReportView> {
  assertAdmin(actor);
  parseInput(zId, reportId);
  const ext = extensionFor(file.contentType, DAMAGE_IMAGE_TYPES);
  if (!ext) throw new DomainError("VALIDATION", "Upload a JPEG, PNG or WebP image.");
  if (!file.data.byteLength || file.data.byteLength > DAMAGE_IMAGE_MAX_BYTES) throw new DomainError("VALIDATION", "Images must be 4 MB or smaller.");
  assertMagicBytes(file.data, file.contentType);
  const [report] = await db.select().from(damageReports).where(eq(damageReports.id, reportId));
  if (!report) throw new DomainError("NOT_FOUND", "Damage report not found.");
  if (report.imageKeys.length >= 10) throw new DomainError("VALIDATION", "At most 10 images per report.");
  const key = `private/damage/${report.vehicleId}/${report.id}/${randomUUID()}.${ext}`;
  await getFileStorage().put(key, file.data, { contentType: file.contentType });
  await db
    .update(damageReports)
    .set({ imageKeys: sql`array_append(${damageReports.imageKeys}, ${key})` })
    .where(eq(damageReports.id, report.id));
  await audit({ actor, action: "damage_report.image_added", entityType: "damage_report", entityId: report.id });
  return (await loadViews(eq(damageReports.id, report.id)))[0];
}

export const updateDamageReportSchema = z.object({
  reportId: zId,
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(3).max(4000).optional(),
  estimatedCostFils: zFils.optional(),
  resolved: z.boolean().optional(),
});

export async function updateDamageReport(actor: Actor, input: z.input<typeof updateDamageReportSchema>): Promise<DamageReportView> {
  assertAdmin(actor);
  const { reportId, resolved, ...rest } = parseInput(updateDamageReportSchema, input);
  const [row] = await db
    .update(damageReports)
    .set({ ...rest, ...(resolved === undefined ? {} : { resolvedAt: resolved ? new Date() : null }) })
    .where(eq(damageReports.id, reportId))
    .returning();
  if (!row) throw new DomainError("NOT_FOUND", "Damage report not found.");
  await audit({ actor, action: "damage_report.updated", entityType: "damage_report", entityId: row.id, data: { ...rest, resolved } });
  return (await loadViews(eq(damageReports.id, row.id)))[0];
}

export const listDamageReportsSchema = z.object({
  vehicleId: zId.optional(),
  reservationId: zId.optional(),
  openOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(100),
});

export async function listDamageReports(actor: Actor, input: z.input<typeof listDamageReportsSchema> = {}): Promise<DamageReportView[]> {
  assertAdmin(actor);
  const f = parseInput(listDamageReportsSchema, input);
  const where: SQL[] = [];
  if (f.vehicleId) where.push(eq(damageReports.vehicleId, f.vehicleId));
  if (f.reservationId) where.push(eq(damageReports.reservationId, f.reservationId));
  if (f.openOnly) where.push(isNull(damageReports.resolvedAt));
  return loadViews(where.length ? and(...where) : undefined, f.limit);
}

export async function getDamageReport(actor: Actor, reportId: string): Promise<DamageReportView> {
  assertAdmin(actor);
  parseInput(zId, reportId);
  const [v] = await loadViews(eq(damageReports.id, reportId));
  if (!v) throw new DomainError("NOT_FOUND", "Damage report not found.");
  return v;
}

/** For the authorised file route: admins only. */
export async function getDamageImage(actor: Actor, reportId: string, index: number): Promise<{ data: Uint8Array; contentType: string }> {
  if (actor.role !== "admin") throw new DomainError("NOT_FOUND", "File not found.");
  parseInput(zId, reportId);
  const [report] = await db.select().from(damageReports).where(eq(damageReports.id, reportId));
  const key = report?.imageKeys[index];
  if (!key) throw new DomainError("NOT_FOUND", "File not found.");
  const data = await getFileStorage().get(key);
  if (!data) throw new DomainError("NOT_FOUND", "File not found.");
  return { data, contentType: contentTypeOf(key) };
}

async function loadViews(where: SQL | undefined, limit = 100): Promise<DamageReportView[]> {
  const rows = await db
    .select({ d: damageReports, make: vehicles.make, model: vehicles.model, year: vehicles.year, plate: vehicles.plateNumber, ref: reservations.reference })
    .from(damageReports)
    .innerJoin(vehicles, eq(vehicles.id, damageReports.vehicleId))
    .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
    .where(where)
    .orderBy(desc(damageReports.createdAt))
    .limit(limit);
  return rows.map((x) =>
    toView(x.d, { vehicleName: `${x.make} ${x.model} ${x.year}`, plateNumber: x.plate, reservationReference: x.ref ?? null }),
  );
}
