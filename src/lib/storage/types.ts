// Provider-neutral file storage. STORAGE_DRIVER picks the implementation (see ./index.ts).
//
// Key convention decides visibility:
//   public/...   vehicle photos; served by /api/files/public/<key> to anyone
//   private/...  licences and damage images; only ever served through an authorised route
// Never hand a raw storage URL for a private file to the browser.

/**
 * Per-file upload cap (4 MB). Vercel Functions reject request bodies over 4.5 MB and uploads go
 * through server actions (serverActions.bodySizeLimit "4.5mb"), so every upload service enforces
 * this. Client-safe: the UI can import it from "@/lib/storage/types".
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type StoredFile = { key: string; size: number };

export type FileVisibility = "public" | "private";

export interface FileStorage {
  readonly name: string;
  /** Keys look like "private/licences/<userId>/<uuid>.jpg". No leading slash, no "..". */
  put(key: string, data: Uint8Array, options?: { contentType?: string }): Promise<StoredFile>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export function visibilityOf(key: string): FileVisibility {
  return key.startsWith("public/") ? "public" : "private";
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export function contentTypeOf(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Extension for an uploaded file's MIME type, or null when the type is not accepted. */
export function extensionFor(contentType: string, allowed: readonly string[]): string | null {
  if (!allowed.includes(contentType)) return null;
  const entry = Object.entries(CONTENT_TYPES).find(([, type]) => type === contentType);
  return entry ? entry[0] : null;
}

/** Public URL for a public key (works for every driver). */
export function publicFileUrl(key: string): string {
  if (visibilityOf(key) !== "public") throw new Error("Not a public key");
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}
