import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import { contentTypeOf, visibilityOf, type FileStorage, type StoredFile } from "./types";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** The subset of @vercel/blob this adapter uses (injectable for unit tests). */
export type BlobSdk = {
  put: typeof put;
  get: typeof get;
  head: typeof head;
  del: typeof del;
};

/**
 * Vercel Blob adapter (STORAGE_DRIVER=vercel-blob, BLOB_READ_WRITE_TOKEN).
 * Keys under public/ are stored with access "public"; everything else with access "private",
 * which requires the token to read, so licences and damage images are only reachable through
 * the app's authorised routes.
 */
export class VercelBlobStorage implements FileStorage {
  readonly name = "vercel-blob";
  private readonly sdk: BlobSdk;
  private readonly token?: string;

  constructor(options: { token?: string; sdk?: BlobSdk } = {}) {
    this.token = options.token;
    this.sdk = options.sdk ?? { put, get, head, del };
  }

  async put(key: string, data: Uint8Array, options: { contentType?: string } = {}): Promise<StoredFile> {
    check(key);
    await this.sdk.put(key, Buffer.from(data), {
      access: visibilityOf(key),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: options.contentType ?? contentTypeOf(key),
      token: this.token,
    });
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    check(key);
    const result = await this.sdk.get(key, { access: visibilityOf(key), token: this.token });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    check(key);
    try {
      await this.sdk.head(key, { token: this.token });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    check(key);
    await this.sdk.del(key, { token: this.token });
  }
}

function check(key: string) {
  if (!KEY_PATTERN.test(key) || key.split("/").some((p) => p === "." || p === "..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
