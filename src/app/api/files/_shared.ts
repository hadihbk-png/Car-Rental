import { isDomainError } from "@/lib/errors";
import { log } from "@/lib/log";

/** Headers for user-supplied files: never sniffed, never scriptable, never cached publicly. */
export function privateFileResponse(data: Uint8Array, contentType: string, filename: string): Response {
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": contentType,
      "content-length": String(data.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** 401 / 404 for auth and missing files; never reveals whether another user's file exists. */
export function fileErrorResponse(err: unknown, requestId: string): Response {
  if (isDomainError(err)) {
    if (err.code === "UNAUTHENTICATED") return Response.json({ error: err.message }, { status: 401 });
    if (err.code === "NOT_FOUND" || err.code === "FORBIDDEN" || err.code === "VALIDATION") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }
  log.error("file route failed", { requestId, error: err });
  return Response.json({ error: "Internal error" }, { status: 500 });
}
