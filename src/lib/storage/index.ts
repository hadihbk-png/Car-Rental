import { assertPersistentDiskAvailable } from "@/lib/platform";
import { LocalFileStorage } from "./local-storage";
import { NetlifyBlobsStorage } from "./netlify-blobs-storage";
import type { FileStorage } from "./types";
import { VercelBlobStorage } from "./vercel-blob-storage";

export * from "./types";

let storage: FileStorage | undefined;

/**
 * Returns the storage named by STORAGE_DRIVER:
 *   local         private folder on disk (default; refused on Netlify, where disk does not persist)
 *   vercel-blob   Vercel Blob (BLOB_READ_WRITE_TOKEN)
 *   netlify-blobs Netlify Blobs (credentials from the Netlify environment)
 */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const driver = process.env.STORAGE_DRIVER || "local";
  switch (driver) {
    case "local":
      assertPersistentDiskAvailable("STORAGE_DRIVER=local", "STORAGE_DRIVER=netlify-blobs");
      storage = new LocalFileStorage(process.env.UPLOADS_DIR || "storage/uploads");
      return storage;
    case "vercel-blob":
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
      storage = new VercelBlobStorage({ token: process.env.BLOB_READ_WRITE_TOKEN });
      return storage;
    case "netlify-blobs":
      storage = new NetlifyBlobsStorage({
        storeName: process.env.NETLIFY_BLOBS_STORE || undefined,
        siteID: process.env.NETLIFY_BLOBS_SITE_ID || undefined,
        token: process.env.NETLIFY_BLOBS_TOKEN || undefined,
      });
      return storage;
    default:
      throw new Error(`STORAGE_DRIVER "${driver}" has no adapter. Use "local", "vercel-blob" or "netlify-blobs".`);
  }
}

/** Tests only: replace (or reset with undefined) the storage singleton. */
export function setFileStorageForTesting(next: FileStorage | undefined) {
  storage = next;
}
