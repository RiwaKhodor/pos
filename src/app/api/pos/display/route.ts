import { authErrorResponse, requireAuth } from "@/lib/auth";
import { showPriceOnDisplay } from "@/lib/price-display";

export async function POST(request: Request) {
  try {
    await requireAuth();
    const body = await request.json().catch(() => ({}));
    const amount = Number(body.amount);
    showPriceOnDisplay(Number.isFinite(amount) ? amount : 0);
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
