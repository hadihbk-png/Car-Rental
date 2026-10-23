import { LocalFileStorage } from "./local-storage";
import type { FileStorage } from "./types";
import { VercelBlobStorage } from "./vercel-blob-storage";

export * from "./types";

let storage: FileStorage | undefined;

/** Returns the storage named by STORAGE_DRIVER: "local" (default) or "vercel-blob". */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      storage = new LocalFileStorage(process.env.UPLOADS_DIR ?? "storage/uploads");
      return storage;
    case "vercel-blob":
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
      storage = new VercelBlobStorage({ token: process.env.BLOB_READ_WRITE_TOKEN });
      return storage;
    default:
      throw new Error(`STORAGE_DRIVER "${driver}" has no adapter. Use "local" or "vercel-blob".`);
  }
}

/** Tests only: replace (or reset with undefined) the storage singleton. */
export function setFileStorageForTesting(next: FileStorage | undefined) {
  storage = next;
}
