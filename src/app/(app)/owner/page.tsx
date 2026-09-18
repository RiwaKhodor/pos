import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { formatMoney } from "@/lib/utils";

export default async function OwnerHomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const [sales, expenses, products] = await Promise.all([
    prisma.sale.findMany({ include: { items: true } }),
    prisma.expense.findMany(),
    prisma.product.findMany({ where: { active: true } }),
  ]);

  const revenue = sales.reduce((sum, s) => sum + toNum(s.total), 0);
  const cogs = sales.reduce(
    (sum, s) =>
      sum +
      s.items.reduce((line, i) => line + toNum(i.unitCost) * i.quantity, 0),
    0
  );
  const expenseTotal = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
  const profit = revenue - cogs - expenseTotal;
  const lowStock = products.filter((p) => p.stock <= p.lowStockAt).length;

  const links = [
    { href: "/items", label: "List of Items" },
    { href: "/items/new", label: "New Item (scan barcode)" },
    { href: "/items/containers", label: "Containers" },
    { href: "/reports/sales-statistics", label: "Sales Statistics" },
    { href: "/reports/profit-loss", label: "Profit & Loss" },
    { href: "/pos", label: "Open POS" },
    { href: "/expenses", label: "Expenses" },
    { href: "/sales", label: "List of Sales" },
  ];

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Home</div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Total Sales</div>
          <div className="text-lg font-bold">{formatMoney(revenue)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Gross Profit</div>
          <div className="text-lg font-bold">{formatMoney(revenue - cogs)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Profit/Loss</div>
          <div className="text-lg font-bold">{formatMoney(profit)}</div>
        </div>
        <div className="border border-[#9a9a9a] bg-white p-3">
          <div className="text-xs text-slate-500">Low Stock Items</div>
          <div className="text-lg font-bold">{lowStock}</div>
        </div>
      </div>

      <div className="desk-grid-wrap" style={{ minHeight: 180 }}>
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
        Expenses total: {formatMoney(expenseTotal)}
      </div>
    </div>
  );
}
