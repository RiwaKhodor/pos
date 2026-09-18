import { authErrorResponse, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";

export async function GET() {
  try {
    const user = await requireAuth();
    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    return jsonMoney({
      user,
      storeName: settings?.storeName || "Store",
      currency: settings?.currency || "USD",
      volumeDiscounts: {
        at100: toNum(settings?.volumeDisc100 ?? 5),
        at200: toNum(settings?.volumeDisc200 ?? 10),
        at300: toNum(settings?.volumeDisc300 ?? 15),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
