import { beforeAll, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "@/db/test-helpers";
import { uploadLicence } from "@/lib/drivers";
import { addVehiclePhoto } from "@/lib/fleet/admin";
import { addDamageImage, createDamageReport } from "@/lib/reservations";
import { MAX_UPLOAD_BYTES } from "./types";

// Every upload path enforces the shared 4 MB cap (Vercel Functions reject bodies over 4.5 MB).

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});

/** PNG signature followed by padding, `size` bytes long. */
function png(size: number): Uint8Array {
  const data = new Uint8Array(size);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return data;
}

describe("upload size cap", () => {
  it("is 4 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
  });

  it("licence: accepts exactly 4 MB, rejects 4 MB + 1 byte", async () => {
    await expect(uploadLicence(f.customer, { data: png(MAX_UPLOAD_BYTES + 1), contentType: "image/png" })).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("4 MB"),
    });
    const ok = await uploadLicence(f.customer, { data: png(MAX_UPLOAD_BYTES), contentType: "image/png" });
    expect(ok.hasLicenceFile).toBe(true);
  });

  it("damage image: rejects over 4 MB, accepts 4 MB", async () => {
    const report = await createDamageReport(f.admin, {
      vehicleId: f.vehicle.id,
      stage: "OTHER",
      severity: "MINOR",
      location: "rear bumper",
      description: "scratch",
    });
    await expect(addDamageImage(f.admin, report.id, { data: png(MAX_UPLOAD_BYTES + 1), contentType: "image/png" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const ok = await addDamageImage(f.admin, report.id, { data: png(MAX_UPLOAD_BYTES), contentType: "image/png" });
    expect(ok.imageUrls).toHaveLength(1);
  });

  it("vehicle photo: rejects over 4 MB, accepts 4 MB", async () => {
    await expect(addVehiclePhoto(f.admin, f.vehicle.id, { data: png(MAX_UPLOAD_BYTES + 1), contentType: "image/png" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const ok = await addVehiclePhoto(f.admin, f.vehicle.id, { data: png(MAX_UPLOAD_BYTES), contentType: "image/png" });
    expect(ok.photoUrls).toHaveLength(1);
  });
});
