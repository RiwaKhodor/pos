import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";
import { listLocalItems } from "@/lib/catalog-cache";
import { listShopSales } from "@/lib/offline-sale";
import { sumExpenses } from "@/lib/expenses";
import { isOwnerWeb } from "@/lib/host";

function parseRange(url: string) {
  const { searchParams } = new URL(url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const start = from ? new Date(`${from}T00:00:00`) : new Date(0);
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date();
  return { start, end, from, to };
}

function inRange(value: string, start: Date, end: Date) {
  const at = new Date(value);
  return at >= start && at <= end;
}

async function localReport(type: string, start: Date, end: Date) {
  const sales = listShopSales().filter((sale) =>
    inRange(sale.createdAt, start, end)
  );
  if (type === "sales-statistics") {
    const skuById = new Map(
      listLocalItems().map((item) => [item.id, item.sku])
    );
    const grouped = new Map<
      string,
      {
        itemName: string;
        sku: string | null;
        salesQty: number;
        totalSales: number;
        totalCost: number;
      }
    >();
    for (const sale of sales) {
      for (const item of sale.items) {
        const current = grouped.get(item.productId) || {
          itemName: item.name,
          sku: skuById.get(item.productId) || null,
          salesQty: 0,
          totalSales: 0,
          totalCost: 0,
        };
        current.salesQty += item.quantity;
        current.totalSales += item.lineTotal;
        current.totalCost += item.unitCost * item.quantity;
        grouped.set(item.productId, current);
      }
    }
    const rows = [...grouped.entries()]
      .map(([productId, row]) => {
        const margin = row.totalSales - row.totalCost;
        const marginPct = row.totalCost > 0 ? (margin / row.totalCost) * 100 : 0;
        return {
          itemCode: row.sku || productId.slice(0, 6),
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
    const totalSales = rows.reduce((sum, row) => sum + row.totalSales, 0);
    return jsonMoney({ rows, totalSales });
  }

  const totalSales = sales.reduce((sum, sale) => sum + toNum(sale.total), 0);
  const cogs = sales.reduce((sum, sale) => sum + toNum(sale.cogs), 0);
  const expenseTotal = await sumExpenses(start, end);
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
}

export async function GET(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "profit-loss";
    const { start, end } = parseRange(request.url);

    if (!isOwnerWeb() && readSnapshot("sales")) {
      return await localReport(type, start, end);
    }

    try {
      if (type === "sales-statistics") {
        const grouped = await prisma.$queryRaw<
          {
            productId: string;
            itemName: string;
            salesQty: bigint;
            totalSales: unknown;
            totalCost: unknown;
            sku: string | null;
          }[]
        >`
          SELECT
            si."productId" AS "productId",
            MAX(si.name) AS "itemName",
            SUM(si.quantity)::bigint AS "salesQty",
            COALESCE(SUM(si."lineTotal"), 0) AS "totalSales",
            COALESCE(SUM(si."unitCost" * si.quantity), 0) AS "totalCost",
            MAX(p.sku) AS sku
          FROM "SaleItem" si
          INNER JOIN "Sale" s ON s.id = si."saleId"
          LEFT JOIN "Product" p ON p.id = si."productId"
          WHERE s."createdAt" >= ${start} AND s."createdAt" <= ${end}
          GROUP BY si."productId"
          ORDER BY COALESCE(SUM(si."lineTotal"), 0) DESC
        `;

        const rows = grouped.map((row) => {
          const totalSales = toNum(row.totalSales);
          const totalCost = toNum(row.totalCost);
          const margin = totalSales - totalCost;
          const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : 0;
          return {
            itemCode: row.sku || row.productId.slice(0, 6),
            itemName: row.itemName,
            salesQty: Number(row.salesQty),
            totalDiscount: 0,
            totalSales: Number(totalSales.toFixed(2)),
            totalCost: Number(totalCost.toFixed(2)),
            margin: Number(margin.toFixed(2)),
            marginPct: Number(marginPct.toFixed(2)),
          };
        });

        const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
        return jsonMoney({ rows, totalSales });
      }

      const [salesAgg, cogsRows, expenseTotal] = await Promise.all([
        prisma.sale.aggregate({
          where: { createdAt: { gte: start, lte: end } },
          _sum: { total: true },
          _count: true,
        }),
        prisma.$queryRaw<[{ cogs: unknown }]>`
          SELECT COALESCE(SUM(si."unitCost" * si.quantity), 0) AS cogs
          FROM "SaleItem" si
          INNER JOIN "Sale" s ON s.id = si."saleId"
          WHERE s."createdAt" >= ${start} AND s."createdAt" <= ${end}
        `,
        sumExpenses(start, end),
      ]);

      const totalSales = toNum(salesAgg._sum.total ?? 0);
      const cogs = toNum(cogsRows[0]?.cogs ?? 0);
      const grossProfit = totalSales - cogs;
      const profitLoss = grossProfit - expenseTotal;

      return jsonMoney({
        summary: {
          totalSales: Number(totalSales.toFixed(2)),
          costOfGoodsSold: Number(cogs.toFixed(2)),
          grossProfit: Number(grossProfit.toFixed(2)),
          expenses: Number(expenseTotal.toFixed(2)),
          profitLoss: Number(profitLoss.toFixed(2)),
          saleCount: salesAgg._count,
        },
      });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      return await localReport(type, start, end);
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
