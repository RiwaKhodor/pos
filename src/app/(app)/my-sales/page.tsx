import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/utils";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { Role } from "@/lib/roles";

export default async function MySalesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sales = await prisma.sale.findMany({
    where: user.role === Role.OWNER ? undefined : { cashierId: user.id },
    include: {
      cashier: { select: { name: true } },
      paymentMethod: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader
        title={user.role === Role.OWNER ? "My / all cashier sales" : "My sales"}
        subtitle={
          user.role === Role.OWNER
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
                  <td>{sale.cashier.name}</td>
                  <td>{sale.paymentMethod.name}</td>
                  <td>{formatMoney(sale.total)}</td>
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
