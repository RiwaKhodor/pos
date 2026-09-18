import { authErrorResponse, requireAuth } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

export async function GET() {
  try {
    const user = await requireAuth();
    const sales = await prisma.sale.findMany({
      where: user.role === Role.OWNER ? undefined : { cashierId: user.id },
      include: {
        cashier: { select: { id: true, name: true } },
        paymentMethod: true,
        customer: true,
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonMoney({ sales });
  } catch (error) {
    return authErrorResponse(error);
  }
}
