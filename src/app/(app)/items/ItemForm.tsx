"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; name: string };
type ContainerOption = { id: string; code: string; name: string };

export type ItemFormValues = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  categoryId: string;
  containerId: string;
  price: string;
  cost: string;
  customsDuty: string;
  wholesalePrice: string;
  stock: string;
  lowStockAt: string;
  maxStock: string;
  active: boolean;
  showInPos: boolean;
  trackQty: boolean;
  description: string;
};

const emptyForm: ItemFormValues = {
  name: "",
  sku: "",
  barcode: "",
  unit: "Pcs",
  categoryId: "",
  containerId: "",
  price: "",
  cost: "0",
  customsDuty: "0",
  wholesalePrice: "0",
  stock: "0",
  lowStockAt: "5",
  maxStock: "0",
  active: true,
  showInPos: true,
  trackQty: true,
  description: "",
};

export function ItemForm({
  categories,
  containers,
  initial,
  mode,
}: {
  categories: Category[];
  containers: ContainerOption[];
  initial?: Partial<ItemFormValues>;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ItemFormValues>({
    ...emptyForm,
    ...initial,
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [scanHint, setScanHint] = useState(
    mode === "create"
      ? "Scan barcode here first, then fill the rest."
      : ""
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "create") {
      barcodeRef.current?.focus();
    }
  }, [mode]);

  function setField<K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onBarcodeScan() {
    const code = form.barcode.trim();
    if (!code) return;

    if (mode === "create") {
      const res = await fetch(`/api/products?q=${encodeURIComponent(code)}`);
      const data = await res.json();
      const existing = (data.products || []).find(
        (p: { barcode?: string | null; sku?: string | null; id: string }) =>
          (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
          (p.sku && p.sku.toLowerCase() === code.toLowerCase())
      );
      if (existing) {
        setScanHint("Barcode already exists — opening item…");
        router.push(`/items/${existing.id}`);
        return;
      }
    }

    setScanHint("Barcode captured. Enter item name and price.");
    nameRef.current?.focus();
  }

  async function save() {
    setError("");
    setSuccess("");
    setSaving(true);
    const creating = mode === "create" && !form.id;
    const payload = {
      name: form.name,
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit: form.unit || "Pcs",
      categoryId: form.categoryId || null,
      containerId: form.containerId || null,
      price: Number(form.price),
      cost: Number(form.cost || 0),
      customsDuty: Number(form.customsDuty || 0),
      wholesalePrice: Number(form.wholesalePrice || 0),
      stock: Number(form.stock || 0),
      lowStockAt: Number(form.lowStockAt || 5),
      maxStock: Number(form.maxStock || 0),
      active: form.active,
      showInPos: form.showInPos,
      trackQty: form.trackQty,
      description: form.description || null,
    };

    const res = await fetch(
      creating ? "/api/products" : `/api/products/${form.id}`,
      {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Save failed");
      return;
    }

    if (creating && data.product?.id) {
      setForm((prev) => ({ ...prev, id: data.product.id }));
      setSuccess(
        `Item added${data.product.name ? `: ${data.product.name}` : ""}.`
      );
    } else {
      setSuccess("Item saved.");
    }

    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  async function removeItem() {
    if (!form.id) return;
    if (!confirm("Remove this item?")) return;
    const res = await fetch(`/api/products/${form.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not remove");
      return;
    }
    router.push("/items");
    router.refresh();
  }

  return (
    <form className="desk-panel" onSubmit={onSubmit}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          {mode === "create"
            ? "New Item"
            : `Item: ${form.name || form.sku || form.id}`}
        </div>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items")}
        >
          Close
        </button>
      </div>

      {scanHint ? (
        <div className="mb-2 border border-[#9bb4cc] bg-[#eef5ff] px-3 py-2 text-xs">
          {scanHint}
        </div>
      ) : null}

      <div className="item-form-layout">
        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Barcode Scan</legend>
            <div className="desk-form-row">
              <label htmlFor="barcode">Barcode</label>
              <input
                id="barcode"
                ref={barcodeRef}
                value={form.barcode}
                onChange={(e) => setField("barcode", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onBarcodeScan();
                  }
                }}
                placeholder="Scan or type barcode, then Enter"
                autoComplete="off"
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="unit">Base Unit</label>
              <input
                id="unit"
                value={form.unit}
                onChange={(e) => setField("unit", e.target.value)}
              />
            </div>
          </fieldset>

          <fieldset className="desk-fieldset">
            <legend>General</legend>
            <div className="desk-form-row">
              <label htmlFor="code">Code</label>
              <input
                id="code"
                value={form.sku}
                onChange={(e) => setField("sku", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                ref={nameRef}
                required
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="pos-name">POS Name</label>
              <input id="pos-name" value={form.name} readOnly />
            </div>
            <div className="desk-form-row">
              <label htmlFor="category">Category</label>
              <select
                id="category"
                value={form.categoryId}
                onChange={(e) => setField("categoryId", e.target.value)}
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="desk-form-row">
              <label htmlFor="container">Container</label>
              <select
                id="container"
                value={form.containerId}
                onChange={(e) => setField("containerId", e.target.value)}
              >
                <option value="">None (not in a container)</option>
                {containers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="desk-form-row">
              <label htmlFor="desc">Description</label>
              <textarea
                id="desc"
                rows={2}
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
              />
            </div>
          </fieldset>

          <fieldset className="desk-fieldset">
            <legend>Inventory</legend>
            <div className="desk-form-row">
              <label htmlFor="stock">Qty On Hand</label>
              <input
                id="stock"
                type="number"
                value={form.stock}
                onChange={(e) => setField("stock", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="min">Min Qty</label>
              <input
                id="min"
                type="number"
                value={form.lowStockAt}
                onChange={(e) => setField("lowStockAt", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="max">Max Qty</label>
              <input
                id="max"
                type="number"
                value={form.maxStock}
                onChange={(e) => setField("maxStock", e.target.value)}
              />
            </div>
          </fieldset>
        </div>

        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Financial</legend>
            <div className="desk-form-row">
              <label htmlFor="cost">Cost</label>
              <input
                id="cost"
                type="number"
                step="0.01"
                value={form.cost}
                onChange={(e) => setField("cost", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="customs">Customs Duty (per unit)</label>
              <input
                id="customs"
                type="number"
                step="0.01"
                min="0"
                value={form.customsDuty}
                onChange={(e) => setField("customsDuty", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label>Landed Cost</label>
              <input
                readOnly
                value={(
                  Number(form.cost || 0) + Number(form.customsDuty || 0)
                ).toFixed(2)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="price">Normal Price</label>
              <input
                id="price"
                type="number"
                step="0.01"
                required
                value={form.price}
                onChange={(e) => setField("price", e.target.value)}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="wholesale">Wholesale Price</label>
              <input
                id="wholesale"
                type="number"
                step="0.01"
                value={form.wholesalePrice}
                onChange={(e) => setField("wholesalePrice", e.target.value)}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Tip: assign items to a container under Inventory → Containers, then
              use Container Customs Duty to split total duty.
            </p>
          </fieldset>
        </div>

        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Options</legend>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!form.active}
                onChange={(e) => setField("active", !e.target.checked)}
              />
              Is Inactive
            </label>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.trackQty}
                onChange={(e) => setField("trackQty", e.target.checked)}
              />
              Track Qty
            </label>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.showInPos}
                onChange={(e) => setField("showInPos", e.target.checked)}
              />
              Show in POS
            </label>
          </fieldset>
        </div>
      </div>

      {error ? (
        <div className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-3 border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="desk-actions">
        <button
          type="button"
          className="desk-btn"
          onClick={() => {
            setForm(emptyForm);
            setError("");
            setSuccess("");
            setScanHint("Scan barcode here first, then fill the rest.");
            router.push("/items/new");
            setTimeout(() => barcodeRef.current?.focus(), 50);
          }}
        >
          New
        </button>
        {mode === "edit" ? (
          <button type="button" className="desk-btn" onClick={removeItem}>
            Remove
          </button>
        ) : null}
        <button type="submit" className="desk-btn" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={saving}
          onClick={() => save()}
        >
          Save/Close
        </button>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
