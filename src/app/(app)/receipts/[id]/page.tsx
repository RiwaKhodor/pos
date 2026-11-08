import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { pricingModeLabel } from "@/lib/price-tiers";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { toNum } from "@/lib/money";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readCachedSettings } from "@/lib/catalog-cache";
import { readLocalSale } from "@/lib/offline-sale";
import { isOwnerWeb } from "@/lib/host";
import { PageHeader, Panel } from "@/components/ui";
import { PrintButton } from "./PrintButton";
import { RECEIPT_LOCATION, RECEIPT_PHONE } from "@/lib/store-info";
import {
  DEFAULT_USD_TO_LBP,
  formatLbp,
  formatRate,
  formatUsd,
  payCurrencyLabel,
  toLbp,
  type PayCurrency,
} from "@/lib/fx";

type Params = { params: Promise<{ id: string }> };

export default async function ReceiptPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const local = isOwnerWeb() ? null : readLocalSale(id);
  type ReceiptSale = {
    id: string;
    receiptNumber: string;
    createdAt: Date | string;
    subtotal: unknown;
    discount: unknown;
    tax: unknown;
    total: unknown;
    exchangeRate: unknown;
    payCurrency: string | null;
    changeCurrency: string | null;
    amountTendered: unknown;
    tenderedUsd?: unknown;
    tenderedLbp?: unknown;
    changeUsd: unknown;
    changeLbp: unknown;
    pricingMode: string;
    cashierId: string;
    cashier: { id: string; name: string };
    paymentMethod: { name: string };
    items: {
      id: string;
      name: string;
      quantity: number;
      unitPrice: unknown;
      lineTotal: unknown;
    }[];
  };
  let sale: ReceiptSale | null = local
    ? {
        ...local,
        cashier: { id: local.cashierId, name: local.cashierName },
        paymentMethod: { name: local.paymentMethodName },
      }
    : null;
  let settings = local
    ? {
        storeName: local.storeName,
        address: local.address,
        phone: local.phone,
        receiptFooter: local.receiptFooter,
      }
    : null;

  if (!sale) {
    try {
      sale = await prisma.sale.findUnique({
        where: { id },
        include: {
          items: true,
          cashier: { select: { id: true, name: true } },
          paymentMethod: true,
          customer: true,
        },
      });
      settings = await prisma.storeSettings.findUnique({
        where: { id: "default" },
      });
    } catch (error) {
      console.error(error);
      const cached = readCachedSettings();
      settings = cached
        ? {
            storeName: cached.storeName,
            address: cached.address,
            phone: cached.phone,
            receiptFooter: cached.receiptFooter,
          }
        : null;
    }
  }

  if (!sale) notFound();
  if (user.role !== Role.OWNER && sale.cashierId !== user.id) {
    redirect("/pos");
  }

  const rate = toNum(sale.exchangeRate) || DEFAULT_USD_TO_LBP;
  const totalUsd = toNum(sale.total);
  const totalLbp = toLbp(totalUsd, rate);
  const payCurrency = (
    sale.payCurrency === "LBP"
      ? "LBP"
      : sale.payCurrency === "MIXED"
        ? "MIXED"
        : "USD"
  ) as PayCurrency;
  const changeCurrency = (
    sale.changeCurrency === "LBP"
      ? "LBP"
      : sale.changeCurrency === "MIXED"
        ? "MIXED"
        : "USD"
  ) as PayCurrency;
  const amountTendered = toNum(sale.amountTendered);
  const tenderedUsd = toNum(sale.tenderedUsd);
  const tenderedLbp = toNum(sale.tenderedLbp);
  const changeUsd = toNum(sale.changeUsd);
  const changeLbp = toNum(sale.changeLbp);
  const hasTender = amountTendered > 0 || tenderedUsd > 0 || tenderedLbp > 0;
  const phone = settings?.phone?.trim() || RECEIPT_PHONE;

  return (
    <div className="receipt-page">
      <div className="print:hidden">
        <PageHeader
          title="Receipt"
          subtitle={sale.receiptNumber}
          actions={
            <>
              <Link
                href={isOwnerWeb() ? "/sales" : "/pos"}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {isOwnerWeb() ? "Back to sales" : "Back to POS"}
              </Link>
              {isOwnerWeb() ? null : (
              <Suspense fallback={null}>
                <PrintButton saleId={sale.id} />
              </Suspense>
              )}
            </>
          }
        />
      </div>

      <Panel className="receipt-slip mx-auto max-w-lg">
        <div className="text-center">
          <div className="text-lg font-semibold">
            {settings?.storeName || "VANO"}
          </div>
          <div className="text-sm" dir="auto">
            {RECEIPT_LOCATION}
          </div>
          {settings?.address && settings.address !== RECEIPT_LOCATION ? (
            <div className="text-sm text-slate-500">{settings.address}</div>
          ) : null}
          <div className="text-sm text-slate-500">{phone}</div>
        </div>

        <div className="mt-4 space-y-1 text-sm text-slate-600">
          <div>Receipt: {sale.receiptNumber}</div>
          <div>Date: {formatDate(sale.createdAt)}</div>
          <div>Cashier: {sale.cashier.name}</div>
          <div>Payment: {sale.paymentMethod.name}</div>
          <div>
            Pricing:{" "}
            {pricingModeLabel(sale.pricingMode)}
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
                    {formatUsd(item.unitPrice)} each
                  </div>
                </td>
                <td>{item.quantity}</td>
                <td>{formatUsd(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatUsd(sale.subtotal)}</span>
          </div>
          {toNum(sale.discount) > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>Discount</span>
              <span>-{formatUsd(sale.discount)}</span>
            </div>
          ) : null}
          {toNum(sale.tax) > 0 ? (
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatUsd(sale.tax)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <span>Total $</span>
            <span>{formatUsd(totalUsd)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Total L.L</span>
            <span>{formatLbp(totalLbp)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Rate</span>
            <span>1 $ = {formatRate(rate)} L.L</span>
          </div>
        </div>

        {hasTender ? (
          <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between">
              <span>Paid in</span>
              <span>{payCurrencyLabel(payCurrency)}</span>
            </div>
            {tenderedUsd > 0 || tenderedLbp > 0 ? (
              <>
                {tenderedUsd > 0 ? (
                  <div className="flex justify-between">
                    <span>Received $</span>
                    <span>{formatUsd(tenderedUsd)}</span>
                  </div>
                ) : null}
                {tenderedLbp > 0 ? (
                  <div className="flex justify-between">
                    <span>Received L.L</span>
                    <span>{formatLbp(tenderedLbp)}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex justify-between">
                <span>Amount received</span>
                <span>
                  {payCurrency === "LBP"
                    ? formatLbp(amountTendered)
                    : formatUsd(amountTendered)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>Change $</span>
              <span>{formatUsd(changeUsd)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Change L.L</span>
              <span>{formatLbp(changeLbp)}</span>
            </div>
            <div className="flex justify-between">
              <span>Change given in</span>
              <span>{payCurrencyLabel(changeCurrency)}</span>
            </div>
          </div>
        ) : null}

        {settings?.receiptFooter ? (
          <p className="mt-6 text-center text-sm text-slate-500">
            {settings.receiptFooter}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
