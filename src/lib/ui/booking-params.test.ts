import { describe, expect, it } from "vitest";
import { bookingQuery, parseBookingParams, parseExtras, serializeExtras } from "./booking-params";

const V = "3f2b8c1e-6a4d-4e1b-9c3a-2d7f5e8a1b0c";
const E1 = "11111111-2222-4333-8444-555555555555";
const E2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("extras param", () => {
  it("round-trips selections and skips zero quantities", () => {
    const s = serializeExtras([
      { extraId: E1, quantity: 2 },
      { extraId: E2, quantity: 0 },
    ]);
    expect(s).toBe(`${E1}:2`);
    expect(parseExtras(s)).toEqual([{ extraId: E1, quantity: 2 }]);
  });

  it("drops junk, duplicates and out-of-range quantities", () => {
    expect(parseExtras(`${E1}:1,${E1}:3,nope:1,${E2}:99,${E2}`)).toEqual([
      { extraId: E1, quantity: 1 },
      { extraId: E2, quantity: 1 },
    ]);
    expect(parseExtras(undefined)).toEqual([]);
  });
});

describe("booking params", () => {
  it("round-trips vehicle, trip and extras", () => {
    const qs = bookingQuery({
      vehicleId: V,
      trip: { pickupBranch: "dubai-marina", pickupDate: "2026-11-01", pickupTime: "10:00", returnDate: "2026-11-03", returnTime: "10:00" },
      extras: [{ extraId: E1, quantity: 1 }],
    });
    const parsed = parseBookingParams(new URLSearchParams(qs.slice(1)));
    expect(parsed).toEqual({
      vehicleId: V,
      trip: {
        pickupBranch: "dubai-marina",
        returnBranch: undefined,
        pickupDate: "2026-11-01",
        pickupTime: "10:00",
        returnDate: "2026-11-03",
        returnTime: "10:00",
      },
      extras: [{ extraId: E1, quantity: 1 }],
    });
  });

  it("rejects a non-uuid vehicle", () => {
    expect(parseBookingParams({ vehicle: "../etc" }).vehicleId).toBeNull();
  });
});
