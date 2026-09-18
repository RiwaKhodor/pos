"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  storeName: string;
  currency: string;
  taxRate: number;
  receiptFooter: string | null;
  volumeDisc100: number;
  volumeDisc200: number;
  volumeDisc300: number;
};

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    storeName: settings.storeName,
    currency: settings.currency,
    taxRate: String(settings.taxRate),
    receiptFooter: settings.receiptFooter || "",
    volumeDisc100: String(settings.volumeDisc100 ?? 5),
    volumeDisc200: String(settings.volumeDisc200 ?? 10),
    volumeDisc300: String(settings.volumeDisc300 ?? 15),
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeName: form.storeName,
        currency: form.currency,
        taxRate: Number(form.taxRate || 0),
        receiptFooter: form.receiptFooter || null,
        volumeDisc100: Number(form.volumeDisc100 || 0),
        volumeDisc200: Number(form.volumeDisc200 || 0),
        volumeDisc300: Number(form.volumeDisc300 || 0),
        address: null,
        phone: null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to save");
      return;
    }
    setMessage("Preferences saved");
    router.refresh();
  }

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Preferences</div>
      <form onSubmit={onSubmit} className="max-w-xl space-y-3">
        <div className="desk-form-row">
          <label htmlFor="storeName">Store Name</label>
          <input
            id="storeName"
            required
            value={form.storeName}
            onChange={(e) => setForm({ ...form, storeName: e.target.value })}
          />
        </div>
        <div className="desk-form-row">
          <label htmlFor="currency">Currency</label>
          <input
            id="currency"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          />
        </div>
        <div className="desk-form-row">
          <label htmlFor="tax">Tax %</label>
          <input
            id="tax"
            type="number"
            step="0.01"
            value={form.taxRate}
            onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
          />
        </div>

        <fieldset className="desk-fieldset">
          <legend>Volume discount % (by receipt total)</legend>
          <p className="mb-2 text-[11px] text-slate-500">
            Used when POS pricing mode is &quot;Volume %&quot;. Example: buy 100+ →
            first %, 200+ → second %, 300+ → third %.
          </p>
          <div className="desk-form-row">
            <label htmlFor="d100">If total ≥ 100</label>
            <input
              id="d100"
              type="number"
              step="0.01"
              min="0"
              value={form.volumeDisc100}
              onChange={(e) =>
                setForm({ ...form, volumeDisc100: e.target.value })
              }
            />
          </div>
          <div className="desk-form-row">
            <label htmlFor="d200">If total ≥ 200</label>
            <input
              id="d200"
              type="number"
              step="0.01"
              min="0"
              value={form.volumeDisc200}
              onChange={(e) =>
                setForm({ ...form, volumeDisc200: e.target.value })
              }
            />
          </div>
          <div className="desk-form-row">
            <label htmlFor="d300">If total ≥ 300</label>
            <input
              id="d300"
              type="number"
              step="0.01"
              min="0"
              value={form.volumeDisc300}
              onChange={(e) =>
                setForm({ ...form, volumeDisc300: e.target.value })
              }
            />
          </div>
        </fieldset>

        <div className="desk-form-row">
          <label htmlFor="footer">Receipt Footer</label>
          <textarea
            id="footer"
            rows={3}
            value={form.receiptFooter}
            onChange={(e) =>
              setForm({ ...form, receiptFooter: e.target.value })
            }
          />
        </div>
        <button type="submit" className="desk-btn">
          Save
        </button>
      </form>
      {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
