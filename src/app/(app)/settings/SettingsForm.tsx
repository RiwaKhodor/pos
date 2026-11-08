"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_USD_TO_LBP, formatIntInput, formatRate } from "@/lib/fx";
import { RECEIPT_PHONE } from "@/lib/store-info";

type Settings = {
  storeName: string;
  usdToLbpRate: number;
  taxRate: number;
  phone: string | null;
  receiptFooter: string | null;
  discAbove500: number;
  discAbove1000: number;
  discAbove3000: number;
  discAbove5000: number;
  discAbove7000: number;
  discAbove10000: number;
};

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    storeName: settings.storeName,
    usdToLbpRate: String(settings.usdToLbpRate || DEFAULT_USD_TO_LBP),
    taxRate: String(settings.taxRate),
    phone: settings.phone || RECEIPT_PHONE,
    receiptFooter: settings.receiptFooter || "",
    discAbove500: String(settings.discAbove500 || ""),
    discAbove1000: String(settings.discAbove1000 || ""),
    discAbove3000: String(settings.discAbove3000 || ""),
    discAbove5000: String(settings.discAbove5000 || ""),
    discAbove7000: String(settings.discAbove7000 || ""),
    discAbove10000: String(settings.discAbove10000 || ""),
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
        usdToLbpRate: Number(
          String(form.usdToLbpRate || DEFAULT_USD_TO_LBP).replace(/,/g, "")
        ),
        taxRate: Number(form.taxRate || 0),
        phone: form.phone.trim() || RECEIPT_PHONE,
        receiptFooter: form.receiptFooter || null,
        discAbove500: Number(form.discAbove500 || 0),
        discAbove1000: Number(form.discAbove1000 || 0),
        discAbove3000: Number(form.discAbove3000 || 0),
        discAbove5000: Number(form.discAbove5000 || 0),
        discAbove7000: Number(form.discAbove7000 || 0),
        discAbove10000: Number(form.discAbove10000 || 0),
      }),
    });
    const data = await res.json();
    if (!res.ok && res.status < 500) {
      setError(data.error || "Failed to save");
      return;
    }
    setMessage("Preferences saved");
    router.refresh();
  }

  const ratePreview = Number(
    String(form.usdToLbpRate || DEFAULT_USD_TO_LBP).replace(/,/g, "")
  );

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Preferences</div>
      <p className="mb-3 text-sm">
        <a className="underline" href="/settings/notifications">
          Notifications
        </a>
      </p>
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

        <fieldset className="desk-fieldset">
          <legend>Currencies</legend>
          <p className="mb-2 text-[11px] text-slate-500">
            Prices are in US Dollars. Customers can pay in Dollars or Lebanese
            Lira (L.L). Change is shown in both.
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
            <div className="border border-[#aaa] bg-white px-3 py-2">
              US Dollars ($)
            </div>
            <div className="border border-[#aaa] bg-white px-3 py-2">
              Lebanese Lira (L.L)
            </div>
          </div>
          <div className="desk-form-row">
            <label htmlFor="rate">USD → L.L rate</label>
            <input
              id="rate"
              inputMode="numeric"
              autoComplete="off"
              required
              value={formatIntInput(form.usdToLbpRate)}
              onChange={(e) =>
                setForm({ ...form, usdToLbpRate: formatIntInput(e.target.value) })
              }
            />
          </div>
          <p className="text-[11px] text-slate-500">
            1 Dollar = {formatRate(ratePreview || DEFAULT_USD_TO_LBP)} L.L
          </p>
        </fieldset>

        <div className="desk-form-row">
          <label htmlFor="tax">Tax %</label>
          <input
            id="tax"
            type="number"
            step="0.01"
            value={form.taxRate}
            onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
          />
          <p className="text-[11px] text-slate-500">
            Added on top of the sale at payment. Item prices stay the same.
          </p>
        </div>

        <div className="desk-form-row">
          <label htmlFor="phone">Receipt phone</label>
          <input
            id="phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder={RECEIPT_PHONE}
          />
        </div>

        <fieldset className="desk-fieldset">
          <legend>Wholesale receipt discount</legend>
          <p className="mb-2 text-[11px] text-slate-500">
            When POS is set to Wholesale — % off receipt, these percents come
            off the normal prices after the receipt reaches that amount. An
            item can cap that with Max discount %. A wholesale price on a line
            skips this % and uses that price instead.
          </p>
          {(
            [
              ["discAbove10000", "Above $10,000"],
              ["discAbove7000", "Above $7,000"],
              ["discAbove5000", "Above $5,000"],
              ["discAbove3000", "Above $3,000"],
              ["discAbove1000", "Above $1,000"],
              ["discAbove500", "Above $500"],
            ] as const
          ).map(([key, label]) => (
            <div className="desk-form-row" key={key}>
              <label htmlFor={key}>{label} %</label>
              <input
                id={key}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form[key]}
                placeholder="0"
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
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
