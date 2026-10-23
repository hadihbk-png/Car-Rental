import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { driverProfiles, type DriverProfile } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/types";
import { DomainError } from "@/lib/errors";
import { getFileStorage } from "@/lib/storage";
import { contentTypeOf, extensionFor } from "@/lib/storage/types";
import { parseInput, zId, zLocalDate } from "@/lib/validation";

export const MIN_DRIVER_AGE = 21;
export const LICENCE_MAX_BYTES = 5 * 1024 * 1024;
export const LICENCE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

/** Driver profile as shown to its owner/admins. The storage key is never exposed. */
export type DriverProfileView = {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceIssuedOn: string | null;
  licenceExpiresOn: string;
  hasLicenceFile: boolean;
  licenceUploadedAt: Date | null;
  /** Authorised route serving the licence file (owner or admin only), or null. */
  licenceFileUrl: string | null;
  /** True when details + licence upload are complete (required before payment). */
  complete: boolean;
};

function toView(p: DriverProfile): DriverProfileView {
  return {
    id: p.id,
    userId: p.userId,
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    nationality: p.nationality,
    licenceNumber: p.licenceNumber,
    licenceCountry: p.licenceCountry,
    licenceIssuedOn: p.licenceIssuedOn,
    licenceExpiresOn: p.licenceExpiresOn,
    hasLicenceFile: !!p.licenceFileKey,
    licenceUploadedAt: p.licenceUploadedAt,
    licenceFileUrl: p.licenceFileKey ? `/api/files/licences/${p.id}` : null,
    complete: !!p.licenceFileKey,
  };
}

function ageOn(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const driverProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Invalid phone number"),
    dateOfBirth: zLocalDate,
    nationality: z.string().trim().min(2).max(60),
    licenceNumber: z.string().trim().min(4).max(40),
    licenceCountry: z.string().trim().min(2).max(60),
    licenceIssuedOn: zLocalDate.optional().nullable(),
    licenceExpiresOn: zLocalDate,
  })
  .refine((p) => p.licenceExpiresOn > p.dateOfBirth, { message: "Invalid licence expiry", path: ["licenceExpiresOn"] });
export type DriverProfileInput = z.input<typeof driverProfileSchema>;

export async function getMyDriverProfile(actor: Actor): Promise<DriverProfileView | null> {
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, actor.id));
  return p ? toView(p) : null;
}

/** Admin: a customer's driver profile. */
export async function getDriverProfileForUser(actor: Actor, userId: string): Promise<DriverProfileView | null> {
  if (actor.role !== "admin" && actor.id !== userId) throw new DomainError("FORBIDDEN", "Not allowed.");
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return p ? toView(p) : null;
}

/** Creates or updates the signed-in user's driver details. */
export async function upsertDriverProfile(actor: Actor, input: DriverProfileInput, now: Date = new Date()): Promise<DriverProfileView> {
  const data = parseInput(driverProfileSchema, input);
  const today = now.toISOString().slice(0, 10);
  if (ageOn(data.dateOfBirth, today) < MIN_DRIVER_AGE) {
    throw new DomainError("VALIDATION", `Drivers must be at least ${MIN_DRIVER_AGE} years old.`, {
      dateOfBirth: [`Must be ${MIN_DRIVER_AGE}+`],
    });
  }
  if (data.licenceExpiresOn <= today) {
    throw new DomainError("VALIDATION", "Your driving licence has expired.", { licenceExpiresOn: ["Expired"] });
  }
  const values = { ...data, licenceIssuedOn: data.licenceIssuedOn ?? null };
  const [row] = await db
    .insert(driverProfiles)
    .values({ userId: actor.id, ...values })
    .onConflictDoUpdate({ target: driverProfiles.userId, set: { ...values, updatedAt: now } })
    .returning();
  await audit({ actor, action: "driver_profile.saved", entityType: "driver_profile", entityId: row.id });
  return toView(row);
}

/** Uploads (replaces) the licence scan. Private storage; served only via the authorised route. */
export async function uploadLicence(
  actor: Actor,
  file: { data: Uint8Array; contentType: string },
): Promise<DriverProfileView> {
  const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, actor.id));
  if (!profile) throw new DomainError("VALIDATION", "Save your driver details before uploading a licence.");
  const ext = extensionFor(file.contentType, LICENCE_CONTENT_TYPES);
  if (!ext) throw new DomainError("VALIDATION", "Upload a JPEG, PNG, WebP or PDF file.", { file: ["Unsupported type"] });
  if (file.data.byteLength === 0 || file.data.byteLength > LICENCE_MAX_BYTES) {
    throw new DomainError("VALIDATION", "The file must be between 1 byte and 5 MB.", { file: ["Too large"] });
  }
  assertMagicBytes(file.data, file.contentType);
  const storage = getFileStorage();
  const key = `private/licences/${actor.id}/${randomUUID()}.${ext}`;
  await storage.put(key, file.data, { contentType: file.contentType });
  const [row] = await db
    .update(driverProfiles)
    .set({ licenceFileKey: key, licenceFileContentType: file.contentType, licenceUploadedAt: new Date() })
    .where(eq(driverProfiles.id, profile.id))
    .returning();
  if (profile.licenceFileKey && profile.licenceFileKey !== key) {
    await storage.delete(profile.licenceFileKey).catch(() => {});
  }
  await audit({ actor, action: "driver_profile.licence_uploaded", entityType: "driver_profile", entityId: profile.id });
  return toView(row);
}

/** The licence file for the authorised route: owner or admin only (others get NOT_FOUND). */
export async function getLicenceFile(
  actor: Actor,
  profileId: string,
): Promise<{ data: Uint8Array; contentType: string }> {
  parseInput(zId, profileId);
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.id, profileId));
  if (!p || !p.licenceFileKey || (actor.role !== "admin" && p.userId !== actor.id)) {
    throw new DomainError("NOT_FOUND", "File not found.");
  }
  const data = await getFileStorage().get(p.licenceFileKey);
  if (!data) throw new DomainError("NOT_FOUND", "File not found.");
  if (actor.role === "admin" && p.userId !== actor.id) {
    await audit({ actor, action: "driver_profile.licence_viewed", entityType: "driver_profile", entityId: p.id });
  }
  return { data, contentType: p.licenceFileContentType ?? contentTypeOf(p.licenceFileKey) };
}

/** Throws POLICY_VIOLATION unless the user has complete driver details valid through returnAt. */
export async function assertDriverReady(tx: DbOrTx, userId: string, returnAt: Date, now: Date = new Date()): Promise<DriverProfile> {
  const [p] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  if (!p) throw new DomainError("POLICY_VIOLATION", "Add your driver details before paying.");
  if (!p.licenceFileKey) throw new DomainError("POLICY_VIOLATION", "Upload your driving licence before paying.");
  if (p.licenceExpiresOn < returnAt.toISOString().slice(0, 10)) {
    throw new DomainError("POLICY_VIOLATION", "Your driving licence expires before the end of the rental.");
  }
  if (ageOn(p.dateOfBirth, now.toISOString().slice(0, 10)) < MIN_DRIVER_AGE) {
    throw new DomainError("POLICY_VIOLATION", `Drivers must be at least ${MIN_DRIVER_AGE} years old.`);
  }
  return p;
}

/** Rejects files whose content does not match the declared type. */
export function assertMagicBytes(data: Uint8Array, contentType: string) {
  const b = data;
  const ok =
    (contentType === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (contentType === "image/png" && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
    (contentType === "image/webp" && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) ||
    (contentType === "application/pdf" && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46);
  if (!ok) throw new DomainError("VALIDATION", "The file content does not match its type.", { file: ["Corrupt or mislabeled file"] });
}
