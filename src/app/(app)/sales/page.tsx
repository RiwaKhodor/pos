import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalSales, listShopSales } from "@/lib/offline-sale";
import { readSnapshot } from "@/lib/local-db";
import { toNum } from "@/lib/money";
import { SalesTable, type SaleRow } from "./SalesTable";
import { isOwnerWeb } from "@/lib/host";

export default async function SalesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  if (isOwnerWeb()) {
    let sales: SaleRow[] = [];
    try {
      const remote = await prisma.sale.findMany({
        include: {
          cashier: { select: { name: true } },
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      sales = remote.map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        total: toNum(sale.total),
        createdAt: sale.createdAt.toISOString(),
        cashierName: sale.cashier.name,
        customerName: sale.customer?.name || "Walk-in",
        itemCount: sale._count.items,
        pending: false,
      }));
    } catch (error) {
      console.error(error);
      return (
        <div>
          <PageHeader title="Sales" subtitle="Receipts saved from the store computer." />
          <p className="text-sm">The sales list did not load. Open this page again.</p>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title="Sales" subtitle="Receipts saved from the store computer." />
        <SalesTable sales={sales} readOnly />
      </div>
    );
  }

  const mirrored = readSnapshot("sales");
  let sales: SaleRow[];
  if (mirrored) {
    sales = listShopSales();
  } else {
    let remote: {
      id: string;
      receiptNumber: string;
      total: unknown;
      createdAt: Date;
      cashier: { name: string };
      customer: { name: string } | null;
      _count: { items: number };
    }[] = [];
    try {
      remote = await prisma.sale.findMany({
        include: {
          cashier: { select: { name: true } },
          paymentMethod: { select: { name: true } },
          customer: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    } catch (error) {
      console.error(error);
    }
    const seen = new Set(remote.map((sale) => sale.id));
    const localOnly = listLocalSales().filter((sale) => !seen.has(sale.id));
    sales = [
      ...localOnly.map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        total: sale.total,
        createdAt: sale.createdAt,
        cashierName: sale.cashierName,
        customerName: "Walk-in",
        itemCount: sale.items.length,
        pending: sale.syncStatus !== "synced",
      })),
      ...remote.map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        total: toNum(sale.total),
        createdAt: sale.createdAt.toISOString(),
        cashierName: sale.cashier.name,
        customerName: sale.customer?.name || "Walk-in",
        itemCount: sale._count.items,
        pending: false,
      })),
    ];
  }

  return (
    <div>
      <PageHeader
        title="All sales"
        subtitle="Owner only. Delete removes the sale and restores stock. Cashiers cannot delete completed sales — they can only void items in POS before payment."
      />
      <SalesTable
        sales={sales.map((sale) => ({
          ...sale,
          total: toNum(sale.total),
          createdAt: String(sale.createdAt),
        }))}
      />
    </div>
  );
}
