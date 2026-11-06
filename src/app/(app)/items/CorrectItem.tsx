"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function CorrectItem({
  item,
}: {
  item: { id: string; name: string; price: string; barcode: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price);
  const [barcode, setBarcode] = useState(item.barcode);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/products/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        price: Number(price),
        barcode,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Could not save");
      return;
    }
    setMessage("Saved. The name, price, and barcode are updated.");
    router.refresh();
  }

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Correct item</div>
      <p className="mb-3 max-w-xl text-xs text-slate-600">
        Fix the name, selling price, or barcode. Only the owner can delete
        this item.
      </p>
      <form onSubmit={onSubmit} className="max-w-xl space-y-3">
        <div className="desk-form-row">
          <label htmlFor="correct-name">Name</label>
          <input
            id="correct-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="desk-form-row">
          <label htmlFor="correct-price">Normal Price</label>
          <input
            id="correct-price"
            type="number"
            step="0.01"
            min="0"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="desk-form-row">
          <label htmlFor="correct-barcode">Barcode</label>
          <input
            id="correct-barcode"
            required
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
          />
        </div>
        <div className="desk-actions">
          <button type="submit" className="desk-btn" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="desk-btn"
            onClick={() => router.push("/items")}
          >
            Close
          </button>
        </div>
      </form>
      {message ? <p className="mt-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
