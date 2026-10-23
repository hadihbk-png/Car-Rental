import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage } from "./local-storage";

describe("LocalFileStorage", () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "driveeasy-uploads-"));
    storage = new LocalFileStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("stores, reads and deletes files", async () => {
    const data = new TextEncoder().encode("licence scan");
    expect(await storage.put("licences/u1/front.jpg", data)).toEqual({ key: "licences/u1/front.jpg", size: 12 });
    expect(await storage.exists("licences/u1/front.jpg")).toBe(true);
    expect(new TextDecoder().decode((await storage.get("licences/u1/front.jpg"))!)).toBe("licence scan");
    await storage.delete("licences/u1/front.jpg");
    expect(await storage.get("licences/u1/front.jpg")).toBeNull();
  });

  it("rejects keys that escape the uploads folder", async () => {
    for (const key of ["../secret", "a/../../b", "/abs", "a\\b", ""]) {
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow("Invalid storage key");
    }
  });

  it("refuses an uploads folder inside public/", () => {
    expect(() => new LocalFileStorage("public/uploads")).toThrow("must not be inside public/");
  });
});
