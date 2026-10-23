import { requireUser } from "@/lib/auth";
import { getLicenceFile } from "@/lib/drivers";
import { requestIdFrom } from "@/lib/log";
import { fileErrorResponse, privateFileResponse } from "../../_shared";

// Driving-licence scans: only the profile owner or an admin.
export async function GET(request: Request, ctx: { params: Promise<{ profileId: string }> }) {
  const requestId = requestIdFrom(request.headers);
  try {
    const actor = await requireUser(request.headers);
    const { profileId } = await ctx.params;
    const file = await getLicenceFile(actor, profileId);
    return privateFileResponse(file.data, file.contentType, `licence-${profileId.slice(0, 8)}`);
  } catch (err) {
    return fileErrorResponse(err, requestId);
  }
}
