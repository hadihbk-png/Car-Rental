import { afterEach, describe, expect, it, vi } from "vitest";
import { getFileStorage, setFileStorageForTesting } from "./index";
import { NetlifyBlobsStorage, type BlobsStoreLike } from "./netlify-blobs-storage";

// Unit tests with a mocked Netlify Blobs store: no network, no Netlify credentials.

function mockStore() {
  const data = new Map<string, { bytes: ArrayBuffer; metadata?: Record<string, unknown> }>();
  const store = {
    set: vi.fn(async (key: string, bytes: ArrayBuffer, options?: { metadata?: Record<string, unknown> }) => {
      data.set(key, { bytes, metadata: options?.metadata });
      return { modified: true };
    }),
    get: vi.fn(async (key: string) => data.get(key)?.bytes ?? null),
    getMetadata: vi.fn(async (key: string) => (data.has(key) ? { etag: "e", metadata: data.get(key)!.metadata ?? {} } : null)),
    delete: vi.fn(async (key: string) => void data.delete(key)),
  } satisfies BlobsStoreLike;
  return { store, data };
}

describe("NetlifyBlobsStorage", () => {
  afterEach(() => {
    setFileStorageForTesting(undefined);
    vi.unstubAllEnvs();
  });

  it("stores, reads, checks and deletes files with their content type", async () => {
    const { store, data } = mockStore();
    const storage = new NetlifyBlobsStorage({ store });
    const bytes = new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 4); // a view with an offset
    expect(await storage.put("private/licences/u1/a.png", bytes, { contentType: "image/png" })).toEqual({
      key: "private/licences/u1/a.png",
      size: 3,
    });
    expect(data.get("private/licences/u1/a.png")?.metadata).toEqual({ contentType: "image/png" });
    expect(Array.from((await storage.get("private/licences/u1/a.png"))!)).toEqual([1, 2, 3]);
    expect(await storage.exists("private/licences/u1/a.png")).toBe(true);
    await storage.delete("private/licences/u1/a.png");
    expect(await storage.exists("private/licences/u1/a.png")).toBe(false);
    expect(await storage.get("private/licences/u1/a.png")).toBeNull();
    await storage.put("public/vehicles/v/a.svg", new Uint8Array([1]));
    expect(store.set.mock.calls[1][2]).toEqual({ metadata: { contentType: "image/svg+xml" } });
  });

  it("rejects keys that try to escape", async () => {
    const storage = new NetlifyBlobsStorage({ store: mockStore().store });
    for (const key of ["../x", "a/../b", "/abs", ""]) {
      await expect(storage.put(key, new Uint8Array())).rejects.toThrow("Invalid storage key");
    }
  });

  it("is selected by STORAGE_DRIVER=netlify-blobs; local disk is refused on Netlify", () => {
    vi.stubEnv("STORAGE_DRIVER", "netlify-blobs");
    expect(getFileStorage().name).toBe("netlify-blobs");
    setFileStorageForTesting(undefined);
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("NETLIFY", "true");
    expect(() => getFileStorage()).toThrow(/STORAGE_DRIVER=netlify-blobs/);
  });
});
