"use client";

import { useEffect, useState } from "react";
import { downloadExcelCsv } from "@/lib/exportCsv";

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

type Summary = {
  totalSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  profitLoss: number;
};

export function ProfitLossReport({ currency }: { currency: string }) {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState("totalSales");
  const [loading, setLoading] = useState(false);

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
          <label>Report Curr.</label>
          <select value={currency} disabled>
            <option value={currency}>{currency}</option>
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
                <td className="report-amount">{formatAmount(row.amount)}</td>
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
                ["Total Sales", summary.totalSales],
                ["Cost Of Goods Sold", summary.costOfGoodsSold],
                ["Gross Profit", summary.grossProfit],
                ["Expenses", summary.expenses],
                ["Profit/Loss", summary.profitLoss],
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
