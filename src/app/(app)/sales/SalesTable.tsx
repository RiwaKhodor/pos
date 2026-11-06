"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, formatMoney } from "@/lib/utils";
import { toNum } from "@/lib/money";
import { EmptyState, Panel } from "@/components/ui";
import { DeleteSaleButton } from "./DeleteSaleButton";

export type SaleRow = {
  id: string;
  receiptNumber: string;
  total: number;
  createdAt: string;
  cashierName: string;
  customerName: string;
  itemCount: number;
  pending: boolean;
};

export function SalesTable({
  sales,
  readOnly = false,
}: {
  sales: SaleRow[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState(sales);

  return (
    <Panel>
      {rows.length === 0 ? (
        <EmptyState message="No transactions yet" />
      ) : (
        <>
          <div className="sale-cards">
            {rows.map((sale) => (
              <Link key={sale.id} href={`/receipts/${sale.id}`} className="sale-card">
                <div className="sale-card-top">
                  <strong>{sale.receiptNumber}</strong>
                  <span>{formatMoney(toNum(sale.total))}</span>
                </div>
                <div className="sale-card-meta">
                  {sale.cashierName} · {sale.itemCount} items · {formatDate(sale.createdAt)}
                </div>
              </Link>
            ))}
          </div>
          <div className="sale-table">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Cashier</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>When</th>
              {readOnly ? null : <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((sale) => (
              <tr key={sale.id}>
                <td>
                  <Link href={`/receipts/${sale.id}`} className="underline">
                    {sale.receiptNumber}
                  </Link>
                </td>
                <td>{sale.cashierName}</td>
                <td>{sale.customerName}</td>
                <td>
                  {sale.itemCount}
                  {sale.pending ? " (on this PC)" : ""}
                </td>
                <td>{formatMoney(toNum(sale.total))}</td>
                <td>{formatDate(sale.createdAt)}</td>
                {readOnly ? null : (
                <td>
                  <DeleteSaleButton
                    id={sale.id}
                    receiptNumber={sale.receiptNumber}
                    onDeleted={() =>
                      setRows((current) =>
                        current.filter((row) => row.id !== sale.id)
                      )
                    }
                    onFailed={() =>
                      setRows((current) =>
                        current.some((row) => row.id === sale.id)
                          ? current
                          : [sale, ...current]
                      )
                    }
                  />
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </>
      )}
    </Panel>
  );
}
