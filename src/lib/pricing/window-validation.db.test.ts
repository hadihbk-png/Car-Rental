// BUG-003 regression: a return time not after the pick-up time must be a VALIDATION error with
// a field error on returnAt (never a raw RangeError / 500) at every entry point.
import { beforeAll, describe, expect, it } from "vitest";
import { createFixture, future, HOUR, key, useMemoryPayments, type Fixture } from "@/db/test-helpers";
import { searchVehicles } from "@/lib/availability";
import { FAKE_PAYMENT_METHODS } from "@/lib/payments";
import { createReservation, modifyReservationDates, payReservation } from "@/lib/reservations";
import { getQuote } from "./quote";

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
  useMemoryPayments();
});

const pickupAt = future(30);
let slot = 60;
const cases = [
  ["one hour before pick-up", new Date(pickupAt.getTime() - HOUR)],
  ["equal to pick-up", pickupAt],
] as const;

const validationOnReturnAt = {
  name: "DomainError",
  code: "VALIDATION",
  fieldErrors: expect.objectContaining({ returnAt: expect.any(Array) }),
};

describe.each(cases)("returnAt %s", (_label, returnAt) => {
  it("createReservation -> VALIDATION on returnAt", async () => {
    await expect(
      createReservation(f.customer, { vehicleId: f.vehicle.id, pickupBranchId: f.branch.id, pickupAt, returnAt, extras: [], idempotencyKey: key() }),
    ).rejects.toMatchObject(validationOnReturnAt);
  });

  it("getQuote -> VALIDATION on returnAt", async () => {
    await expect(getQuote({ vehicleId: f.vehicle.id, pickupBranchId: f.branch.id, pickupAt, returnAt, extras: [] })).rejects.toMatchObject(
      validationOnReturnAt,
    );
  });

  it("searchVehicles -> VALIDATION on returnAt", async () => {
    await expect(searchVehicles({ pickupBranchId: f.branch.id, pickupAt, returnAt })).rejects.toMatchObject(validationOnReturnAt);
  });

  it("modifyReservationDates -> VALIDATION on returnAt", async () => {
    slot += 5;
    const r = await createReservation(f.customer, {
      vehicleId: f.vehicle.id,
      pickupBranchId: f.branch.id,
      pickupAt: future(slot),
      returnAt: future(slot + 2),
      extras: [],
      idempotencyKey: key(),
    });
    await payReservation(f.customer, { reservationId: r.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key() });
    await expect(
      modifyReservationDates(f.customer, { reservationId: r.id, pickupAt, returnAt, idempotencyKey: key() }),
    ).rejects.toMatchObject(validationOnReturnAt);
  });
});
