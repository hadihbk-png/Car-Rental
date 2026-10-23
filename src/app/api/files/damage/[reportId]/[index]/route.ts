import { requireUser } from "@/lib/auth";
import { requestIdFrom } from "@/lib/log";
import { getDamageImage } from "@/lib/reservations/damage";
import { fileErrorResponse, privateFileResponse } from "../../../_shared";

// Damage-report images: admins only.
export async function GET(request: Request, ctx: { params: Promise<{ reportId: string; index: string }> }) {
  const requestId = requestIdFrom(request.headers);
  try {
    const actor = await requireUser(request.headers);
    const { reportId, index } = await ctx.params;
    const i = /^\d{1,2}$/.test(index) ? Number(index) : -1;
    const file = await getDamageImage(actor, reportId, i);
    return privateFileResponse(file.data, file.contentType, `damage-${reportId.slice(0, 8)}-${i}`);
  } catch (err) {
    return fileErrorResponse(err, requestId);
  }
}
