import { authErrorResponse, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";

    const products = await prisma.product.findMany({
      where: {
        active: true,
        showInPos: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        price: true,
        wholesalePrice: true,
        stock: true,
        trackQty: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
      take: 50,
    });

    return jsonMoney({ products });
  } catch (error) {
    return authErrorResponse(error);
  }
}
