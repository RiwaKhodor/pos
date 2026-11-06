import { authErrorResponse, requireAuth } from "@/lib/auth";
import { syncSnapshotLive } from "@/lib/sync-sales";

export async function GET() {
  try {
    await requireAuth();
    return Response.json(await syncSnapshotLive());
  } catch (error) {
    return authErrorResponse(error);
  }
}
