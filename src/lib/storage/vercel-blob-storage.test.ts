import { BlobNotFoundError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { publicFileUrl, visibilityOf } from "./types";
import { VercelBlobStorage, type BlobSdk } from "./vercel-blob-storage";

// Unit tests with a mocked @vercel/blob SDK: no network, no token.

function setup() {
  const store = new Map<string, { data: Uint8Array; access: string }>();
  const sdk = {
    put: vi.fn(async (pathname: string, body: unknown, opts: { access: string }) => {
      store.set(pathname, { data: new Uint8Array(body as Buffer), access: opts.access });
      return { url: `https://store.blob.vercel-storage.com/${pathname}`, downloadUrl: "", pathname, contentType: "", contentDisposition: "", etag: "" };
    }),
    get: vi.fn(async (pathname: string, opts: { access: string }) => {
      const hit = store.get(pathname);
      if (!hit || hit.access !== opts.access) return null;
      return { statusCode: 200, stream: new Response(Buffer.from(hit.data)).body!, headers: new Headers(), blob: {} };
    }),
    head: vi.fn(async (pathname: string) => {
      if (!store.has(pathname)) throw new BlobNotFoundError();
      return {};
    }),
    del: vi.fn(async (pathname: string) => {
      store.delete(pathname);
    }),
  };
  const storage = new VercelBlobStorage({ token: "vercel_blob_rw_test", sdk: sdk as unknown as BlobSdk });
  return { sdk, storage, store };
}

describe("VercelBlobStorage", () => {
  it("stores licences and damage images as private blobs, photos as public", async () => {
    const { sdk, storage, store } = setup();
    await storage.put("private/licences/u1/a.png", new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    await storage.put("public/vehicles/v1/a.svg", new Uint8Array([4]));
    expect(store.get("private/licences/u1/a.png")?.access).toBe("private");
    expect(store.get("public/vehicles/v1/a.svg")?.access).toBe("public");
    expect(sdk.put.mock.calls[0][2]).toMatchObject({ access: "private", addRandomSuffix: false, contentType: "image/png", token: "vercel_blob_rw_test" });
    expect(sdk.put.mock.calls[1][2]).toMatchObject({ access: "public", contentType: "image/svg+xml" });
  });

  it("reads, checks and deletes", async () => {
    const { storage } = setup();
    await storage.put("private/damage/v/r/x.jpg", new Uint8Array([9, 8]));
    expect(Array.from((await storage.get("private/damage/v/r/x.jpg"))!)).toEqual([9, 8]);
    expect(await storage.exists("private/damage/v/r/x.jpg")).toBe(true);
    await storage.delete("private/damage/v/r/x.jpg");
    expect(await storage.exists("private/damage/v/r/x.jpg")).toBe(false);
    expect(await storage.get("private/damage/v/r/x.jpg")).toBeNull();
  });

  it("rejects keys that try to escape", async () => {
    const { storage } = setup();
    for (const key of ["../x", "a/../b", "/abs", ""]) {
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow("Invalid storage key");
    }
  });

  it("only builds public URLs for public keys", () => {
    expect(visibilityOf("private/licences/u/a.png")).toBe("private");
    expect(publicFileUrl("public/vehicles/v/a.svg")).toBe("/api/files/public/vehicles/v/a.svg");
    expect(() => publicFileUrl("private/licences/u/a.png")).toThrow();
  });
});
