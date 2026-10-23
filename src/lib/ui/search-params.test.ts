import { describe, expect, it } from "vitest";
import {
  buildHref,
  clearRefinements,
  countRefinements,
  filtersToRecord,
  hasCompleteTrip,
  parseSearchFilters,
  serializeSearchFilters,
  toQueryString,
  withFilter,
} from "./search-params";

describe("parseSearchFilters", () => {
  it("parses a full Next.js searchParams record", () => {
    const f = parseSearchFilters({
      pickupBranch: "dubai-airport",
      returnBranch: "abu-dhabi-airport",
      pickupDate: "2026-11-01",
      pickupTime: "10:00",
      returnDate: "2026-11-04",
      returnTime: "10:30",
      category: "suv",
      transmission: "AUTOMATIC",
      fuel: ["PETROL", "HYBRID"],
      seats: "5",
      minPrice: "100",
      maxPrice: "400",
      sort: "price-desc",
      page: "2",
    });
    expect(f).toEqual({
      pickupBranch: "dubai-airport",
      returnBranch: "abu-dhabi-airport",
      pickupDate: "2026-11-01",
      pickupTime: "10:00",
      returnDate: "2026-11-04",
      returnTime: "10:30",
      category: "suv",
      transmission: "AUTOMATIC",
      fuel: "PETROL",
      seats: 5,
      minPrice: 100,
      maxPrice: 400,
      sort: "price-desc",
      page: 2,
    });
  });

  it("drops malformed values instead of throwing", () => {
    const f = parseSearchFilters(
      new URLSearchParams(
        "pickupBranch=<script>&pickupDate=2026-02-30&pickupTime=25:00&seats=-1&minPrice=abc&sort=evil&page=0&category=bad%20value&fuel=ok",
      ),
    );
    expect(f).toEqual({ fuel: "ok" });
  });

  it("accepts UUID branch ids", () => {
    const id = "3f2b8c1e-6a4d-4e1b-9c3a-2d7f5e8a1b0c";
    expect(parseSearchFilters({ pickupBranch: id }).pickupBranch).toBe(id);
  });

  it("swaps an inverted price range", () => {
    const f = parseSearchFilters({ minPrice: "500", maxPrice: "100" });
    expect(f.minPrice).toBe(100);
    expect(f.maxPrice).toBe(500);
  });

  it("omits defaults (price-asc sort, page 1)", () => {
    expect(parseSearchFilters({ sort: "price-asc", page: "1" })).toEqual({});
  });
});

describe("serializeSearchFilters", () => {
  it("writes a stable, compact query string", () => {
    const qs = serializeSearchFilters({
      page: 3,
      category: "suv",
      pickupBranch: "dxb",
      minPrice: 0,
      sort: "price-asc",
    }).toString();
    expect(qs).toBe("pickupBranch=dxb&category=suv&minPrice=0&page=3");
  });

  it("round-trips through parse", () => {
    const original = {
      pickupBranch: "dxb",
      pickupDate: "2026-11-01",
      pickupTime: "09:00",
      returnDate: "2026-11-02",
      returnTime: "09:00",
      transmission: "MANUAL",
      seats: 7,
      sort: "name" as const,
    };
    expect(parseSearchFilters(serializeSearchFilters(original))).toEqual(original);
    expect(toQueryString({})).toBe("");
    expect(toQueryString({ seats: 4 })).toBe("?seats=4");
  });
});

describe("filter helpers", () => {
  it("resets the page when a filter changes", () => {
    expect(withFilter({ page: 4, seats: 5 }, "category", "suv")).toEqual({ seats: 5, category: "suv" });
    expect(withFilter({ page: 4 }, "page", 5)).toEqual({ page: 5 });
    expect(withFilter({ category: "suv" }, "category", undefined)).toEqual({});
  });

  it("clears refinements but keeps the trip and sort", () => {
    const trip = { pickupBranch: "dxb", pickupDate: "2026-11-01", sort: "price-desc" as const };
    expect(clearRefinements({ ...trip, seats: 5, fuel: "ELECTRIC", maxPrice: 300, page: 2 })).toEqual(trip);
  });

  it("counts refinements with the price range as one", () => {
    expect(countRefinements({})).toBe(0);
    expect(countRefinements({ category: "suv", minPrice: 1, maxPrice: 2, seats: 5 })).toBe(3);
  });

  it("detects a complete trip", () => {
    expect(hasCompleteTrip({ pickupBranch: "a", pickupDate: "2026-11-01", pickupTime: "10:00" })).toBe(false);
    expect(
      hasCompleteTrip({
        pickupBranch: "a",
        pickupDate: "2026-11-01",
        pickupTime: "10:00",
        returnDate: "2026-11-02",
        returnTime: "10:00",
      }),
    ).toBe(true);
  });

  it("builds hrefs and plain records", () => {
    expect(buildHref("/search", { page: "2", seats: undefined, sort: "" })).toBe("/search?page=2");
    expect(buildHref("/search", {})).toBe("/search");
    expect(filtersToRecord({ seats: 5, category: "suv" })).toEqual({ category: "suv", seats: "5" });
  });
});
