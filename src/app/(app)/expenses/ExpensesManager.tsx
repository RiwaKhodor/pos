"use client";

import { FormEvent, useState } from "react";
import { Panel } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/utils";
import { isConnectionFailure } from "@/lib/connection-failure";

type Expense = {
  id: string;
  amount: number;
  note: string;
  date: string;
};

export function ExpensesManager({ expenses }: { expenses: Expense[] }) {
  const [rows, setRows] = useState(expenses);
  const [form, setForm] = useState({ amount: "", note: "", date: "" });
  const [error, setError] = useState("");

  async function createExpense(e: FormEvent) {
    e.preventDefault();
    setError("");
    const draft: Expense = {
      id: `new-${Date.now()}`,
      amount: Number(form.amount),
      note: form.note,
      date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
    };
    setRows((current) => [draft, ...current]);
    setForm({ amount: "", note: "", date: "" });
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: draft.amount,
        note: draft.note,
        date: form.date || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRows((current) => current.filter((row) => row.id !== draft.id));
      setForm({
        amount: String(draft.amount),
        note: draft.note,
        date: form.date,
      });
      setError(data.error || "Failed to add expense");
      return;
    }
    const saved = data.expense as Expense;
    setRows((current) =>
      current.map((row) => (row.id === draft.id ? saved : row))
    );
  }

  async function removeExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    const previous = rows;
    setRows((current) => current.filter((row) => row.id !== id));
    const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (isConnectionFailure(res.status, data.error)) return;
      setRows(previous);
      setError(data.error || "Could not delete this expense");
    }
  }

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Expenses</div>
      <form onSubmit={createExpense} className="desk-toolbar mb-3">
        <div className="desk-field">
          <label htmlFor="exp-amount">Amount</label>
          <input
            id="exp-amount"
            required
            type="number"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </div>
        <div className="desk-field" style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="exp-note">Note</label>
          <input
            id="exp-note"
            required
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="e.g. Electricity"
          />
        </div>
        <div className="desk-field">
          <label htmlFor="exp-date">Date</label>
          <input
            id="exp-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <button type="submit" className="desk-btn">
          Add expense
        </button>
      </form>
      {error ? (
        <p className="mb-2 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Note</th>
              <th>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>No expenses yet.</td>
              </tr>
            ) : (
              rows.map((expense) => (
                <tr key={expense.id}>
                  <td>{formatDate(expense.date)}</td>
                  <td>{expense.note}</td>
                  <td className="report-amount">
                    {formatMoney(expense.amount)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-xs text-red-600 underline"
                      onClick={() => removeExpense(expense.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
