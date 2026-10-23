import { describe, expect, it } from "vitest";
import { describeAccept, formatBytes, validateFile } from "./files";

const rules = { accept: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 5 * 1024 * 1024 };

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(12.4 * 1024 * 1024)).toBe("12 MB");
  });
});

describe("validateFile", () => {
  it("accepts allowed types within the limit", () => {
    expect(validateFile({ name: "licence.jpg", size: 200_000, type: "image/jpeg" }, rules)).toBeNull();
    expect(validateFile({ name: "x.webp", size: 10, type: "image/webp" }, { accept: ["image/*"], maxBytes: 100 })).toBeNull();
  });

  it("explains the problem", () => {
    expect(validateFile({ name: "a.gif", size: 10, type: "image/gif" }, rules)).toBe(
      "a.gif is not a supported file type. Use JPG, PNG or PDF.",
    );
    expect(validateFile({ name: "big.png", size: 6 * 1024 * 1024, type: "image/png" }, rules)).toBe(
      "big.png is 6 MB. The maximum size is 5 MB.",
    );
    expect(validateFile({ name: "empty.png", size: 0, type: "image/png" }, rules)).toMatch(/empty/);
  });

  it("describes accepted types", () => {
    expect(describeAccept(["application/pdf"])).toBe("PDF");
    expect(describeAccept(["image/jpeg", "image/png"])).toBe("JPG or PNG");
  });
});
