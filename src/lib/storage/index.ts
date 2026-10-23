import { LocalFileStorage } from "./local-storage";
import type { FileStorage } from "./types";

export * from "./types";

let storage: FileStorage | undefined;

/** Returns the storage named by STORAGE_DRIVER. Add the real adapter as a new case. */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      storage = new LocalFileStorage(process.env.UPLOADS_DIR ?? "storage/uploads");
      return storage;
    default:
      throw new Error(`STORAGE_DRIVER "${driver}" has no adapter yet. Add one in src/lib/storage/.`);
  }
}
