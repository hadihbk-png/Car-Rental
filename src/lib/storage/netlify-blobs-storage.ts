import { getStore } from "@netlify/blobs";
import { contentTypeOf, type FileStorage, type StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
export const NETLIFY_FILES_STORE = "driveeasy-files";

/** The subset of a @netlify/blobs Store this adapter uses (injectable for unit tests). */
export type BlobsStoreLike = {
  set(key: string, data: ArrayBuffer, options?: { metadata?: Record<string, unknown> }): Promise<unknown>;
  get(key: string, options: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  getMetadata(key: string): Promise<{ etag: string | undefined; metadata: Record<string, unknown> } | null>;
  delete(key: string): Promise<void>;
};

/**
 * Netlify Blobs adapter (STORAGE_DRIVER=netlify-blobs). One site-wide store; Netlify Blobs has no
 * public URLs, so every file (public/ photos and private/ licences and damage images) is only
 * reachable through the app's /api/files routes, which apply the same authorisation as locally.
 * Credentials come from the Netlify Functions environment (NETLIFY_BLOBS_CONTEXT); outside
 * Netlify set NETLIFY_BLOBS_SITE_ID and NETLIFY_BLOBS_TOKEN.
 */
export class NetlifyBlobsStorage implements FileStorage {
  readonly name = "netlify-blobs";
  private store?: BlobsStoreLike;

  constructor(private readonly options: { storeName?: string; store?: BlobsStoreLike; siteID?: string; token?: string } = {}) {
    this.store = options.store;
  }

  /** Created on first use: the Netlify environment is only readable at request time. */
  private blobs(): BlobsStoreLike {
    this.store ??= getStore({
      name: this.options.storeName ?? NETLIFY_FILES_STORE,
      consistency: "strong",
      ...(this.options.siteID && this.options.token ? { siteID: this.options.siteID, token: this.options.token } : {}),
    }) as unknown as BlobsStoreLike;
    return this.store;
  }

  async put(key: string, data: Uint8Array, options: { contentType?: string } = {}): Promise<StoredFile> {
    check(key);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await this.blobs().set(key, buffer, { metadata: { contentType: options.contentType ?? contentTypeOf(key) } });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    check(key);
    const data = await this.blobs().get(key, { type: "arrayBuffer" });
    return data ? new Uint8Array(data) : null;
  }

  async exists(key: string): Promise<boolean> {
    check(key);
    return (await this.blobs().getMetadata(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    check(key);
    await this.blobs().delete(key);
  }
}

function check(key: string) {
  if (!KEY_PATTERN.test(key) || key.split("/").some((p) => p === "." || p === "..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
