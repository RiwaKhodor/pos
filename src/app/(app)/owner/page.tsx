import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { formatMoney } from "@/lib/utils";
import { toNum } from "@/lib/money";
import { getCachedOwnerStats, getCachedInventory } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalItems } from "@/lib/catalog-cache";
import { readSnapshot } from "@/lib/local-db";
import { listLocalSales, listShopSales } from "@/lib/offline-sale";
import { sumExpenses } from "@/lib/expenses";
import { isOwnerWeb } from "@/lib/host";
import { prisma } from "@/lib/prisma";

export default async function OwnerHomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  if (isOwnerWeb()) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    let revenue = 0;
    let cogs = 0;
    let expenseTotal = 0;
    let lowStock = 0;
    try {
      const rows = await prisma.$queryRaw<
        { revenue: unknown; cogs: unknown; expenses: unknown; low_stock: unknown }[]
      >`
        SELECT
          COALESCE((
            SELECT SUM(total) FROM "Sale"
            WHERE "createdAt" >= ${monthStart} AND "createdAt" <= ${monthEnd}
          ), 0) AS revenue,
          COALESCE((
            SELECT SUM(si."unitCost" * si.quantity)
            FROM "SaleItem" si
            INNER JOIN "Sale" s ON s.id = si."saleId"
            WHERE s."createdAt" >= ${monthStart} AND s."createdAt" <= ${monthEnd}
          ), 0) AS cogs,
          COALESCE((
            SELECT SUM(amount) FROM "Expense"
            WHERE date >= ${monthStart} AND date <= ${monthEnd}
          ), 0) AS expenses,
          (
            SELECT COUNT(*) FROM "Product"
            WHERE active = true AND stock <= "lowStockAt"
          ) AS low_stock
      `;
      revenue = toNum(rows[0]?.revenue ?? 0);
      cogs = toNum(rows[0]?.cogs ?? 0);
      expenseTotal = toNum(rows[0]?.expenses ?? 0);
      lowStock = Number(rows[0]?.low_stock ?? 0);
    } catch (error) {
      console.error(error);
    }
    const profit = revenue - cogs - expenseTotal;
    const links = [
      { href: "/items", label: "List of Items" },
      { href: "/sales", label: "List of Sales" },
      { href: "/expenses", label: "Expenses" },
      { href: "/reports/sales-statistics", label: "Sales Statistics" },
      { href: "/reports/profit-loss", label: "Profit & Loss" },
      { href: "/settings/notifications", label: "Notifications" },
    ];
    return (
      <div className="desk-panel">
        <div className="mb-3 text-sm font-bold">Home</div>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <div className="border border-[#9a9a9a] bg-white p-3">
            <div className="text-xs text-slate-500">Total Sales this month</div>
            <div className="text-lg font-bold">{formatMoney(revenue)}</div>
          </div>
          <div className="border border-[#9a9a9a] bg-white p-3">
            <div className="text-xs text-slate-500">Gross Profit this month</div>
            <div className="text-lg font-bold">{formatMoney(revenue - cogs)}</div>
          </div>
          <div className="border border-[#9a9a9a] bg-white p-3">
            <div className="text-xs text-slate-500">Profit/Loss this month</div>
            <div className="text-lg font-bold">{formatMoney(profit)}</div>
          </div>
          <div className="border border-[#9a9a9a] bg-white p-3">
            <div className="text-xs text-slate-500">Low Stock Items</div>
            <div className="text-lg font-bold">{lowStock}</div>
          </div>
        </div>
        <div className="owner-phone-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Expenses this month: {formatMoney(expenseTotal)}. Changes are made on the store computer.
        </p>
      </div>
    );
  }

  const localItems = listLocalItems();
  let revenue = 0;
  let cogs = 0;
  let expenseTotal = 0;
  let lowStock = localItems.filter(
    (item) => item.active && item.stock <= item.lowStockAt
  ).length;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  if (readSnapshot("sales")) {
    for (const sale of listShopSales()) {
      if (new Date(sale.createdAt) < monthStart) continue;
      revenue += toNum(sale.total);
      cogs += toNum(sale.cogs);
    }
  } else {
    try {
      const stats = await getCachedOwnerStats();
      revenue = stats.revenue;
      cogs = stats.cogs;
    } catch (error) {
      console.error(error);
    }
    for (const sale of listLocalSales()) {
      if (sale.syncStatus === "synced") continue;
      if (new Date(sale.createdAt) < monthStart) continue;
      revenue += sale.total;
      cogs += sale.items.reduce(
        (sum, item) => sum + item.unitCost * item.quantity,
        0
      );
    }
    if (localItems.length === 0) {
      try {
        const products = await getCachedInventory();
        lowStock = products.filter((item) => item.stock <= item.lowStockAt).length;
      } catch (error) {
        console.error(error);
      }
    }
  }
  const monthEnd = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  expenseTotal = await sumExpenses(monthStart, monthEnd);
  const profit = revenue - cogs - expenseTotal;

  const links = [
    { href: "/items", label: "List of Items" },
    { href: "/items/new", label: "New Item (scan barcode)" },
    { href: "/items/containers", label: "Containers" },
    { href: "/reports/sales-statistics", label: "Sales Statistics" },
    { href: "/reports/profit-loss", label: "Profit & Loss" },
    { href: "/settings/notifications", label: "Notifications" },
    { href: "/pos", label: "Open POS" },
    { href: "/expenses", label: "Expenses" },
    { href: "/sales", label: "List of Sales" },
  ];

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Home</div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Total Sales this month</div>
          <div className="text-lg font-bold">{formatMoney(revenue)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Gross Profit this month</div>
          <div className="text-lg font-bold">{formatMoney(revenue - cogs)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Profit/Loss this month</div>
          <div className="text-lg font-bold">{formatMoney(profit)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Low Stock Items</div>
          <div className="text-lg font-bold">{lowStock}</div>
        </div>
      </div>

      <div className="owner-phone-links">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </div>
      <div className="desk-grid-wrap owner-desktop-links" style={{ minHeight: 180 }}>
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Quick Open</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.href}>
                <td>
                  <Link className="underline" href={link.href}>
                    {link.label}
                  </Link>
                </td>
                <td>
                  {link.href === "/pos"
                    ? "Open the selling screen"
                    : `Open ${link.label}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">
        Expenses this month: {formatMoney(expenseTotal)}
      </div>
    </div>
  );
}
