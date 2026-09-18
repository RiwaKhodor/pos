import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";

export async function GET() {
  try {
    await requireRole(Role.OWNER);

    const [sales, expenses, lowStock, recentSales] = await Promise.all([
      prisma.sale.findMany({ include: { items: true } }),
      prisma.expense.findMany(),
      prisma.product.findMany({
        where: { active: true },
        orderBy: { stock: "asc" },
      }),
      prisma.sale.findMany({
        include: {
          cashier: { select: { name: true } },
          paymentMethod: true,
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

    const revenue = sales.reduce((sum, s) => sum + toNum(s.total), 0);
    const cogs = sales.reduce(
      (sum, s) =>
        sum +
        s.items.reduce(
          (line, i) => line + toNum(i.unitCost) * i.quantity,
          0
        ),
      0
    );
    const expenseTotal = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);

    return jsonMoney({
      revenue,
      profit: revenue - cogs - expenseTotal,
      expenseTotal,
      saleCount: sales.length,
      lowStock: lowStock.filter((p) => p.stock <= p.lowStockAt).slice(0, 8),
      recentSales,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
