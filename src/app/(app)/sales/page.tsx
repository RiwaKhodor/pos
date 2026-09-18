import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { DeleteSaleButton } from "./DeleteSaleButton";

export default async function SalesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const sales = await prisma.sale.findMany({
    include: {
      cashier: { select: { name: true } },
      paymentMethod: true,
      customer: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <PageHeader
        title="All sales"
        subtitle="Owner only. Delete removes the sale and restores stock. Cashiers cannot delete completed sales — they can only void items in POS before payment."
      />
      <Panel>
        {sales.length === 0 ? (
          <EmptyState message="No transactions yet" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Cashier</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link href={`/receipts/${sale.id}`} className="underline">
                      {sale.receiptNumber}
                    </Link>
                  </td>
                  <td>{sale.cashier.name}</td>
                  <td>{sale.customer?.name || "Walk-in"}</td>
                  <td>{sale.items.length}</td>
                  <td>{formatMoney(sale.total)}</td>
                  <td>{formatDate(sale.createdAt)}</td>
                  <td>
                    <DeleteSaleButton
                      id={sale.id}
                      receiptNumber={sale.receiptNumber}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
