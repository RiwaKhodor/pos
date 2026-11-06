import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { vapidPublicKey } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const publicKey = vapidPublicKey();
    return Response.json({ publicKey: publicKey || null });
  } catch (error) {
    return authErrorResponse(error);
  }
}
