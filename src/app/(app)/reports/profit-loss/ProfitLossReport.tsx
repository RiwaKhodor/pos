"use client";

import { useEffect, useState } from "react";
import { downloadExcelCsv } from "@/lib/exportCsv";
import { formatLbp, toLbp } from "@/lib/fx";

function todayIso() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function monthStartIso() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}-01`;
}

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type Summary = {
  totalSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  profitLoss: number;
};

export function ProfitLossReport({
  currency,
  usdToLbpRate,
}: {
  currency: string;
  usdToLbpRate: number;
}) {
  const [reportCurr, setReportCurr] = useState(currency || "USD");
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState("totalSales");
  const [loading, setLoading] = useState(false);
  const rate = usdToLbpRate > 0 ? usdToLbpRate : 89500;
  const inLbp = reportCurr === "LBP";

  function money(n: number) {
    return inLbp ? formatLbp(toLbp(n, rate)) : formatAmount(n);
  }

  async function fill() {
    setLoading(true);
    const res = await fetch(
      `/api/reports?type=profit-loss&from=${from}&to=${to}`
    );
    const data = await res.json();
    setSummary(data.summary || null);
    setLoading(false);
  }

  useEffect(() => {
    fill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = summary
    ? [
        { key: "totalSales", label: "Total Sales", amount: summary.totalSales },
        {
          key: "cogs",
          label: "Cost Of Goods Sold",
          amount: summary.costOfGoodsSold,
        },
        {
          key: "gross",
          label: "Gross Profit",
          amount: summary.grossProfit,
          bold: true,
        },
        {
          key: "expenses",
          label: "Expenses",
          amount: summary.expenses,
        },
        {
          key: "pl",
          label: "Profit/Loss",
          amount: summary.profitLoss,
          bold: true,
        },
      ]
    : [];

  return (
    <div className="desk-panel">
      <div className="desk-toolbar">
        <div className="desk-field">
          <label>Between</label>
          <div className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="desk-field">
          <label htmlFor="pl-curr">Report Curr.</label>
          <select
            id="pl-curr"
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
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-selected={selected === row.key}
                className={row.bold ? "report-bold" : undefined}
                onClick={() => setSelected(row.key)}
              >
                <td>{row.label}</td>
                <td className="report-amount">{money(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="desk-actions">
        <button type="button" className="desk-btn" onClick={() => window.print()}>
          Print
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={!summary}
          onClick={() => {
            if (!summary) return;
            downloadExcelCsv(
              `profit-loss-${from}_to_${to}.csv`,
              ["Description", "Amount"],
              [
                ["Total Sales", inLbp ? toLbp(summary.totalSales, rate) : summary.totalSales],
                ["Cost Of Goods Sold", inLbp ? toLbp(summary.costOfGoodsSold, rate) : summary.costOfGoodsSold],
                ["Gross Profit", inLbp ? toLbp(summary.grossProfit, rate) : summary.grossProfit],
                ["Expenses", inLbp ? toLbp(summary.expenses, rate) : summary.expenses],
                ["Profit/Loss", inLbp ? toLbp(summary.profitLoss, rate) : summary.profitLoss],
              ]
            );
          }}
        >
          Excel
        </button>
      </div>
    </div>
  );
}
