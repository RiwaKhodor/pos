import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney } from "@/lib/utils";
import { toNum } from "@/lib/money";
import { PageHeader, Panel } from "@/components/ui";
import { PrintButton } from "./PrintButton";

type Params = { params: Promise<{ id: string }> };

export default async function ReceiptPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: true,
      cashier: { select: { id: true, name: true } },
      paymentMethod: true,
      customer: true,
    },
  });

  if (!sale) notFound();
  if (user.role !== Role.OWNER && sale.cashierId !== user.id) {
    redirect("/my-sales");
  }

  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
  });

  return (
    <div className="receipt-page">
      <div className="print:hidden">
        <PageHeader
          title="Receipt"
          subtitle={sale.receiptNumber}
          actions={
            <>
              <Link
                href="/pos"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                Back to POS
              </Link>
              <Suspense fallback={null}>
                <PrintButton />
              </Suspense>
            </>
          }
        />
      </div>

      <Panel className="receipt-slip mx-auto max-w-lg">
        <div className="text-center">
          <div className="text-lg font-semibold">
            {settings?.storeName || "Store"}
          </div>
          {settings?.address ? (
            <div className="text-sm text-slate-500">{settings.address}</div>
          ) : null}
          {settings?.phone ? (
            <div className="text-sm text-slate-500">{settings.phone}</div>
          ) : null}
        </div>

        <div className="mt-4 space-y-1 text-sm text-slate-600">
          <div>Receipt: {sale.receiptNumber}</div>
          <div>Date: {formatDate(sale.createdAt)}</div>
          <div>Cashier: {sale.cashier.name}</div>
          <div>Payment: {sale.paymentMethod.name}</div>
          <div>
            Pricing:{" "}
            {sale.pricingMode === "WHOLESALE"
              ? "Wholesale"
              : sale.pricingMode === "VOLUME"
                ? "Volume %"
                : "Regular"}
          </div>
        </div>

        <table className="mt-4">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div>{item.name}</div>
                  <div className="text-xs text-slate-400">
                    {formatMoney(item.unitPrice)} each
                  </div>
                </td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(sale.subtotal)}</span>
          </div>
          {toNum(sale.discount) > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>Discount</span>
              <span>-{formatMoney(sale.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>Tax</span>
            <span>{formatMoney(sale.tax)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span>{formatMoney(sale.total)}</span>
          </div>
        </div>

        {settings?.receiptFooter ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            {settings.receiptFooter}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
