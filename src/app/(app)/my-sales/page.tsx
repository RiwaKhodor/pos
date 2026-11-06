import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/utils";
import { toNum } from "@/lib/money";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { Role } from "@/lib/roles";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalSales, listShopSales } from "@/lib/offline-sale";
import { readSnapshot } from "@/lib/local-db";

export default async function MySalesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const mirrored = readSnapshot("sales");
  let offline = false;
  let sales: {
    id: string;
    receiptNumber: string;
    cashierName: string;
    paymentName: string;
    total: number | unknown;
    createdAt: string | Date;
    note: string;
  }[];

  if (mirrored) {
    sales = listShopSales(
      user.role === Role.OWNER ? undefined : user.id
    ).map((sale) => ({
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      cashierName: sale.cashierName,
      paymentName: sale.paymentName,
      total: sale.total,
      createdAt: sale.createdAt,
      note: sale.pending ? " (saved on this PC)" : "",
    }));
  } else {
    let remote: {
      id: string;
      receiptNumber: string;
      total: unknown;
      createdAt: Date;
      cashier: { name: string };
      paymentMethod: { name: string };
    }[] = [];
    try {
      remote = await prisma.sale.findMany({
        where: user.role === Role.OWNER ? undefined : { cashierId: user.id },
        include: {
          cashier: { select: { name: true } },
          paymentMethod: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    } catch (error) {
      console.error(error);
      offline = true;
    }
    const seen = new Set(remote.map((sale) => sale.id));
    const waiting = listLocalSales(
      user.role === Role.OWNER ? undefined : user.id
    ).filter((sale) => !seen.has(sale.id));
    sales = [
      ...waiting.map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        cashierName: sale.cashierName,
        paymentName: sale.paymentMethodName,
        total: sale.total,
        createdAt: sale.createdAt,
        note:
          sale.syncStatus === "pending"
            ? " (waiting to upload)"
            : sale.syncStatus === "failed"
              ? " (upload failed, still saved here)"
              : sale.syncStatus === "conflict"
                ? " (uploaded, stock differed)"
                : "",
      })),
      ...remote.map((sale) => ({
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        cashierName: sale.cashier.name,
        paymentName: sale.paymentMethod.name,
        total: sale.total,
        createdAt: sale.createdAt,
        note: "",
      })),
    ];
  }

  return (
    <div>
      <PageHeader
        title={user.role === Role.OWNER ? "My / all cashier sales" : "My sales"}
        subtitle={
          offline
            ? "Showing sales saved on this computer. Online sales appear again when the connection returns."
            : user.role === Role.OWNER
              ? "Owners can see every sale here; employees only see their own"
              : "Only the sales you completed"
        }
      />
      <Panel>
        {sales.length === 0 ? (
          <EmptyState message="No sales yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Cashier</th>
                <th>Payment</th>
                <th>Total</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link
                      href={`/receipts/${sale.id}`}
                      className="underline"
                    >
                      {sale.receiptNumber}
                    </Link>
                  </td>
                  <td>{sale.cashierName}</td>
                  <td>
                    {sale.paymentName}
                    {sale.note}
                  </td>
                  <td>{formatMoney(toNum(sale.total))}</td>
                  <td>{formatDate(sale.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
