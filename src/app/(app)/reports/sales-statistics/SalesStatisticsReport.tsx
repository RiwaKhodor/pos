"use client";

import { useEffect, useState } from "react";
import { downloadExcelCsv } from "@/lib/exportCsv";
import { formatLbp, toLbp } from "@/lib/fx";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type Row = {
  itemCode: string;
  itemName: string;
  salesQty: number;
  totalDiscount: number;
  totalSales: number;
  totalCost: number;
  margin: number;
  marginPct: number;
};

export function SalesStatisticsReport({
  currency,
  usdToLbpRate,
}: {
  currency: string;
  usdToLbpRate: number;
}) {
  const [reportCurr, setReportCurr] = useState(currency || "USD");
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<Row[]>([]);
  const [totalSales, setTotalSales] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rate = usdToLbpRate > 0 ? usdToLbpRate : 89500;
  const inLbp = reportCurr === "LBP";

  function money(n: number) {
    return inLbp ? formatLbp(toLbp(n, rate)) : formatAmount(n);
  }

  async function fill() {
    setLoading(true);
    const res = await fetch(
      `/api/reports?type=sales-statistics&from=${from}&to=${to}`
    );
    const data = await res.json();
    setRows(data.rows || []);
    setTotalSales(data.totalSales || 0);
    setSelected(data.rows?.[0]?.itemCode ?? null);
    setLoading(false);
  }

  useEffect(() => {
    fill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="desk-panel">
      <div className="desk-toolbar">
        <div className="desk-field">
          <label>Type</label>
          <select defaultValue="by-item">
            <option value="by-item">By Item</option>
          </select>
        </div>
        <div className="desk-field">
          <label>Between</label>
          <div className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="desk-field">
          <label htmlFor="sales-curr">Report Curr.</label>
          <select
            id="sales-curr"
            value={reportCurr}
            onChange={(e) => setReportCurr(e.target.value)}
          >
            <option value="USD">USD</option>
            <option value="LBP">L.L</option>
          </select>
        </div>
        <button type="button" className="desk-btn" onClick={fill} disabled={loading}>
          {loading ? "Loading..." : "Fill"}
        </button>
      </div>

      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>Sales Qty</th>
              <th>Total Discount</th>
              <th>Total Sales</th>
              <th>Total Cost</th>
              <th>Margin</th>
              <th>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>No sales in this period.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.itemCode + row.itemName}
                  data-selected={selected === row.itemCode}
                  onClick={() => setSelected(row.itemCode)}
                >
                  <td>{row.itemCode}</td>
                  <td>{row.itemName}</td>
                  <td className="report-amount">{row.salesQty.toFixed(1)}</td>
                  <td className="report-amount">{money(row.totalDiscount)}</td>
                  <td className="report-amount">{money(row.totalSales)}</td>
                  <td className="report-amount">{money(row.totalCost)}</td>
                  <td className="report-amount">{money(row.margin)}</td>
                  <td className="report-amount">
                    {formatAmount(row.marginPct)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="desk-actions items-center justify-between">
        <div className="flex gap-2">
          <button type="button" className="desk-btn" onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="desk-btn"
            onClick={() =>
              downloadExcelCsv(
                `sales-statistics-${from}_to_${to}.csv`,
                [
                  "Item Code",
                  "Item Name",
                  "Sales Qty",
                  "Total Discount",
                  "Total Sales",
                  "Total Cost",
                  "Margin",
                  "Margin %",
                ],
                rows.map((row) => [
                  row.itemCode,
                  row.itemName,
                  row.salesQty,
                  inLbp ? toLbp(row.totalDiscount, rate) : row.totalDiscount,
                  inLbp ? toLbp(row.totalSales, rate) : row.totalSales,
                  inLbp ? toLbp(row.totalCost, rate) : row.totalCost,
                  inLbp ? toLbp(row.margin, rate) : row.margin,
                  row.marginPct,
                ])
              )
            }
          >
            Excel
          </button>
        </div>
        <div className="text-sm font-bold">
          TOTAL SALES: {money(totalSales)}
        </div>
      </div>
    </div>
  );
}
