import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";

function parseRange(url: string) {
  const { searchParams } = new URL(url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const start = from ? new Date(`${from}T00:00:00`) : new Date(0);
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date();
  return { start, end, from, to };
}

export async function GET(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "profit-loss";
    const { start, end } = parseRange(request.url);

    if (type === "sales-statistics") {
      const sales = await prisma.sale.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: { items: true },
      });

      const byProduct = new Map<
        string,
        {
          productId: string;
          itemCode: string;
          itemName: string;
          salesQty: number;
          totalSales: number;
          totalCost: number;
        }
      >();

      for (const sale of sales) {
        for (const item of sale.items) {
          const current = byProduct.get(item.productId) || {
            productId: item.productId,
            itemCode: "",
            itemName: item.name,
            salesQty: 0,
            totalSales: 0,
            totalCost: 0,
          };
          current.salesQty += item.quantity;
          current.totalSales += toNum(item.lineTotal);
          current.totalCost += toNum(item.unitCost) * item.quantity;
          current.itemName = item.name;
          byProduct.set(item.productId, current);
        }
      }

      const productIds = Array.from(byProduct.keys());
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true },
      });
      const skuMap = new Map(products.map((p) => [p.id, p.sku || ""]));

      const rows = Array.from(byProduct.values())
        .map((row) => {
          const margin = row.totalSales - row.totalCost;
          const marginPct =
            row.totalCost > 0 ? (margin / row.totalCost) * 100 : 0;
          return {
            itemCode: skuMap.get(row.productId) || row.productId.slice(0, 6),
            itemName: row.itemName,
            salesQty: row.salesQty,
            totalDiscount: 0,
            totalSales: Number(row.totalSales.toFixed(2)),
            totalCost: Number(row.totalCost.toFixed(2)),
            margin: Number(margin.toFixed(2)),
            marginPct: Number(marginPct.toFixed(2)),
          };
        })
        .sort((a, b) => b.totalSales - a.totalSales);

      const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);

      return jsonMoney({ rows, totalSales });
    }

    const [sales, expenses] = await Promise.all([
      prisma.sale.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: { items: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: start, lte: end } },
      }),
    ]);

    const totalSales = sales.reduce((sum, s) => sum + toNum(s.total), 0);
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
    const grossProfit = totalSales - cogs;
    const profitLoss = grossProfit - expenseTotal;

    return jsonMoney({
      summary: {
        totalSales: Number(totalSales.toFixed(2)),
        costOfGoodsSold: Number(cogs.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        expenses: Number(expenseTotal.toFixed(2)),
        profitLoss: Number(profitLoss.toFixed(2)),
        saleCount: sales.length,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
