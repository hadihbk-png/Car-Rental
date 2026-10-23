import { describe, expect, it } from "vitest";
import { paginationRange } from "./pagination";

describe("paginationRange", () => {
  it("lists every page when there are few", () => {
    expect(paginationRange(1, 0)).toEqual([]);
    expect(paginationRange(1, 1)).toEqual([1]);
    expect(paginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("adds ellipses around the current page and keeps a constant width", () => {
    expect(paginationRange(1, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 20]);
    expect(paginationRange(10, 20)).toEqual([1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20]);
    expect(paginationRange(20, 20)).toEqual([1, "ellipsis-start", 16, 17, 18, 19, 20]);
    for (let p = 1; p <= 20; p++) expect(paginationRange(p, 20)).toHaveLength(7);
  });

  it("clamps out-of-range pages", () => {
    expect(paginationRange(99, 8)).toEqual([1, "ellipsis-start", 4, 5, 6, 7, 8]);
    expect(paginationRange(-3, 8)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 8]);
  });
});
