// Provider-neutral private file storage. STORAGE_DRIVER picks the implementation
// (see ./index.ts). Files are never publicly reachable; serve them through an
// authorised route that calls get().

export type StoredFile = { key: string; size: number };

export interface FileStorage {
  readonly name: string;
  /** Keys look like "licences/<userId>/front.jpg". No leading slash, no "..". */
  put(key: string, data: Uint8Array): Promise<StoredFile>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
