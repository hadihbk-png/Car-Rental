import { log, requestIdFrom } from "@/lib/log";
import { getFileStorage } from "@/lib/storage";
import { contentTypeOf } from "@/lib/storage/types";

// Public vehicle photos (keys under public/). Private keys are never reachable here.
export async function GET(request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = ["public", ...parts].join("/");
  if (!/^public\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(key) || parts.some((p) => p === ".." || p === ".")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const data = await getFileStorage().get(key);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Buffer.from(data), {
      headers: {
        "content-type": contentTypeOf(key),
        "content-length": String(data.byteLength),
        // Keys are unique per upload, so the content never changes.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    log.error("public file failed", { requestId: requestIdFrom(request.headers), key, error: err });
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
