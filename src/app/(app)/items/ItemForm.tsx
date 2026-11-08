"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Barcode } from "@/components/Barcode";
import { customsFromContainer } from "@/lib/container-duty";
import { formatUsd } from "@/lib/fx";
import { Role } from "@/lib/roles";

type Category = { id: string; name: string };
type ContainerOption = {
  id: string;
  code: string;
  name: string;
  cost: number;
  totalDuty: number;
};

export type ItemLot = {
  id?: string;
  containerId: string;
  quantity: string;
  cost: string;
  customsDuty: string;
};

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
  onlinePrice: string;
  retailPrice: string;
  maxDiscountPercent: string;
  wholesaleMinQty: string;
  wholesaleMaxQty: string;
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
  onlinePrice: "",
  retailPrice: "",
  maxDiscountPercent: "",
  wholesaleMinQty: "",
  wholesaleMaxQty: "0",
  stock: "0",
  lowStockAt: "",
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
  initialLots,
  mode,
  role = Role.OWNER,
}: {
  categories: Category[];
  containers: ContainerOption[];
  initial?: Partial<ItemFormValues>;
  initialLots?: ItemLot[];
  mode: "create" | "edit";
  role?: Role;
}) {
  const isOwner = role === Role.OWNER;
  const fullItemForm = isOwner || mode === "create";
  const homeHref = "/items";
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
      ? "Type the name and price. Put the barcode you want on the item, or leave barcode empty and the system creates one. To add more of an item you already have, type its name or item code and press Enter."
      : ""
  );
  const [labelCopies, setLabelCopies] = useState("1");
  const [saving, setSaving] = useState(false);
  const [printLabel, setPrintLabel] = useState<{
    name: string;
    price: number;
    barcode: string;
    quantity: number;
  } | null>(null);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [arrivalOf, setArrivalOf] = useState<string | null>(null);
  const [lotRows, setLotRows] = useState<ItemLot[]>(
    initialLots && initialLots.length > 0
      ? initialLots
      : [
          {
            containerId: initial?.containerId || "",
            quantity: initial?.stock || "0",
            cost: initial?.cost || "0",
            customsDuty: initial?.customsDuty || "0",
          },
        ]
  );
  const [sellWholesale, setSellWholesale] = useState(
    Number(initial?.wholesaleMinQty || 0) > 0 ||
      Number(initial?.wholesalePrice || 0) > 0
  );

  useEffect(() => {
    if (mode === "create") {
      nameRef.current?.focus();
    }
  }, [mode]);

  function dutyFor(containerId: string, cost: string) {
    if (!containerId) return null;
    const container = containers.find((item) => item.id === containerId);
    if (!container) return null;
    return customsFromContainer(Number(cost) || 0, container);
  }

  function updateLot(
    index: number,
    patch: Partial<ItemLot>
  ) {
    setLotRows((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (patch.customsDuty === undefined) {
          const duty = dutyFor(next.containerId, next.cost);
          if (duty != null) next.customsDuty = String(duty);
        }
        return next;
      })
    );
  }

  function setField<K extends keyof ItemFormValues>(
    key: K,
    value: ItemFormValues[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onBarcodeScan(raw?: string) {
    const code = (raw ?? form.barcode).trim();
    if (!code) return;

    if (mode === "create") {
      const res = await fetch(`/api/products?q=${encodeURIComponent(code)}`);
      const data = await res.json();
      const products = (data.products || []) as {
        barcode?: string | null;
        sku?: string | null;
        name?: string;
        id: string;
      }[];
      const byName = products.filter(
        (p) => p.name && p.name.toLowerCase() === code.toLowerCase()
      );
      const existing =
        products.find(
          (p) =>
            (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
            (p.sku && p.sku.toLowerCase() === code.toLowerCase())
        ) || (byName.length === 1 ? byName[0] : null);
      if (byName.length > 1 && !existing) {
        setError("More than one item has this name. Type the item code instead.");
        setScanHint("Type the item code from List of Items, then press Enter.");
        return;
      }
      if (existing) {
        const item = existing as {
          id: string;
          name?: string;
          sku?: string | null;
          barcode?: string | null;
          unit?: string | null;
          categoryId?: string | null;
          price?: number | string;
          wholesalePrice?: number | string;
          wholesaleMinQty?: number;
          wholesaleMaxQty?: number;
          lowStockAt?: number;
          maxStock?: number;
          active?: boolean;
          showInPos?: boolean;
          trackQty?: boolean;
          description?: string | null;
        };
        setArrivalOf(item.id);
        setForm((prev) => ({
          ...prev,
          id: item.id,
          name: item.name || prev.name,
          sku: item.sku || "",
          barcode: item.barcode || "",
          unit: item.unit || prev.unit,
          categoryId: item.categoryId || "",
          price: item.price != null ? String(item.price) : prev.price,
          wholesalePrice:
            item.wholesalePrice != null
              ? String(item.wholesalePrice)
              : prev.wholesalePrice,
          wholesaleMinQty: String(item.wholesaleMinQty ?? prev.wholesaleMinQty),
          wholesaleMaxQty: String(item.wholesaleMaxQty ?? prev.wholesaleMaxQty),
          lowStockAt: String(item.lowStockAt ?? prev.lowStockAt),
          maxStock: String(item.maxStock ?? prev.maxStock),
          active: item.active !== false,
          showInPos: item.showInPos !== false,
          trackQty: item.trackQty !== false,
          description: item.description || "",
        }));
        setLotRows([
          {
            containerId: "",
            quantity: "",
            cost: "",
            customsDuty: "0",
          },
        ]);
        setSellWholesale(
          Number(item.wholesaleMinQty || 0) > 0 ||
            Number(item.wholesalePrice || 0) > 0
        );
        setError("");
        setScanHint(
          "This item is already in the store. Type how many arrived, the cost, and the customs. A container is optional. Older stock still sells first."
        );
        return;
      }
      setArrivalOf(null);
      if (raw != null) setField("barcode", raw);
    }

    setScanHint("Barcode captured. Enter item name and price.");
    nameRef.current?.focus();
  }

  async function save() {
    setError("");
    setSuccess("");
    if (
      sellWholesale &&
      Number(form.wholesaleMaxQty || 0) > 0 &&
      Number(form.wholesaleMinQty || 0) > Number(form.wholesaleMaxQty || 0)
    ) {
      setError("Wholesale min qty cannot be greater than max qty.");
      return;
    }
    const receiving = mode === "create" && Boolean(arrivalOf);
    if (receiving) {
      const arrival = lotRows[0];
      if (!(Number(arrival?.quantity) > 0)) {
        setError("Enter how many pieces arrived.");
        return;
      }
    }
    setSaving(true);
    const creating = mode === "create" && !form.id && !receiving;
    const payload: Record<string, unknown> = {
      name: form.name,
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit: form.unit || "Pcs",
      categoryId: form.categoryId || null,
      containerId: fullItemForm ? form.containerId || null : null,
      stock: Number(form.stock || 0),
      lowStockAt: Number(form.lowStockAt || 0),
      maxStock: Number(form.maxStock || 0),
      active: form.active,
      showInPos: form.showInPos,
      trackQty: form.trackQty,
      description: form.description || null,
      wholesaleMinQty: sellWholesale ? Number(form.wholesaleMinQty || 0) : 0,
      wholesaleMaxQty: sellWholesale ? Number(form.wholesaleMaxQty || 0) : 0,
      ...(fullItemForm && !receiving
        ? {
            lots: lotRows.map((lot) => ({
              id: lot.id,
              containerId: lot.containerId || null,
              quantity: Number(lot.quantity || 0),
              cost: Number(lot.cost || 0),
              customsDuty: Number(lot.customsDuty || 0),
            })),
          }
        : {}),
      ...(receiving
        ? {
            appendLot: {
              containerId: lotRows[0]?.containerId || null,
              quantity: Number(lotRows[0]?.quantity || 0),
              cost: Number(lotRows[0]?.cost || 0),
              customsDuty: Number(lotRows[0]?.customsDuty || 0),
            },
          }
        : {}),
    };
    payload.price = Number(form.price);
    if (fullItemForm) {
      const priced =
        lotRows.find((lot) => Number(lot.quantity) > 0) || lotRows[0];
      payload.cost = Number(priced?.cost || 0);
      payload.customsDuty = Number(priced?.customsDuty || 0);
      payload.wholesalePrice = sellWholesale
        ? Number(form.wholesalePrice || 0)
        : 0;
      payload.onlinePrice = Number(form.onlinePrice || 0);
      payload.retailPrice = Number(form.retailPrice || 0);
      payload.maxDiscountPercent =
        form.maxDiscountPercent.trim() === ""
          ? null
          : Math.min(100, Math.max(0, Number(form.maxDiscountPercent)));
    }

    const res = await fetch(
      creating ? "/api/products" : `/api/products/${arrivalOf || form.id}`,
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

    if (receiving) {
      const madeBarcode = String(data.product?.barcode || form.barcode || "");
      const arrived = Math.min(
        200,
        Math.max(1, Math.floor(Number(lotRows[0]?.quantity) || 1))
      );
      setForm((prev) => ({
        ...prev,
        barcode: madeBarcode || prev.barcode,
        name: data.product?.name || prev.name,
      }));
      if (madeBarcode) {
        setPrintLabel({
          name: data.product?.name || form.name,
          price: Number(data.product?.price ?? form.price),
          barcode: madeBarcode,
          quantity: arrived,
        });
        setLabelCopies(String(arrived));
        setSuccess(
          `Added to ${data.product?.name || "the item"}. The barcode stays ${madeBarcode}. Print 1 label, or ${arrived} for the new pieces.`
        );
      } else {
        setSuccess(
          `Added to ${data.product?.name || "the item"}. Older stock still sells first.`
        );
      }
      setLotRows([
        { containerId: "", quantity: "", cost: "", customsDuty: "0" },
      ]);
    } else if (creating && data.product?.id) {
      const madeBarcode = String(data.product.barcode || form.barcode || "");
      setForm((prev) => ({
        ...prev,
        id: data.product.id,
        barcode: madeBarcode || prev.barcode,
      }));
      if (madeBarcode) {
        const arrived = Math.min(
          200,
          Math.max(1, Math.floor(Number(lotRows[0]?.quantity) || Number(form.stock) || 1))
        );
        setPrintLabel({
          name: data.product.name || form.name,
          price: Number(data.product.price ?? form.price),
          barcode: madeBarcode,
          quantity: arrived,
        });
        setLabelCopies(String(arrived));
        setSuccess(
          `Item added${data.product.name ? `: ${data.product.name}` : ""}. Barcode ${madeBarcode} is ready. Print 1 label, or ${arrived} for every piece.`
        );
      } else {
        setSuccess(
          `Item added${data.product.name ? `: ${data.product.name}` : ""}.`
        );
      }
    } else {
      setSuccess("Item saved.");
    }

    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  async function printStickers(count: number) {
    if (!printLabel) return;
    const copies = Math.min(200, Math.max(1, Math.floor(count)));
    setPrintingLabel(true);
    setError("");
    const res = await fetch("/api/items/labels/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        labels: Array.from({ length: copies }, () => ({
          name: printLabel.name,
          price: printLabel.price,
          barcode: printLabel.barcode,
        })),
      }),
    });
    const data = await res.json();
    setPrintingLabel(false);
    if (!res.ok) {
      setError(data.error || "Could not print the label");
      return;
    }
    setSuccess(
      copies === 1
        ? "Sent 1 label to the label printer."
        : `Sent ${copies} labels to the label printer.`
    );
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
    router.push(homeHref);
    router.refresh();
  }

  return (
    <form className="desk-panel item-form-screen" onSubmit={onSubmit}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          {mode === "create"
            ? "New Item"
            : `Item: ${form.name || form.sku || form.id}`}
        </div>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push(homeHref)}
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
                onChange={(e) => {
                  setField("barcode", e.target.value);
                  if (arrivalOf) {
                    setArrivalOf(null);
                    setForm((prev) => ({ ...prev, id: undefined }));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onBarcodeScan((e.target as HTMLInputElement).value);
                  }
                }}
                placeholder="Your barcode, or leave empty to create one"
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
            {fullItemForm ? (
              <div className="mb-2 text-[11px] text-slate-600">
                Container is optional. If you choose one, customs each is the
                item cost times that container’s customs share.
              </div>
            ) : null}
            {fullItemForm ? (
              <div className="mb-2 text-[11px] text-slate-600">
                On hand{" "}
                <strong>
                  {lotRows.reduce(
                    (sum, lot) => sum + (Number(lot.quantity) || 0),
                    0
                  )}
                </strong>
                . Oldest container sells first. The receipt stays one line.
              </div>
            ) : (
            <div className="desk-form-row">
              <label htmlFor="stock">Qty On Hand</label>
              <input
                id="stock"
                type="number"
                value={form.stock}
                onChange={(e) => setField("stock", e.target.value)}
              />
            </div>
            )}
            {fullItemForm ? (
              <div className="mb-2 space-y-2">
                {lotRows.map((lot, index) => (
                  <div
                    key={lot.id || index}
                    className="space-y-1 border border-[#ccc] bg-white p-2"
                  >
                    <div className="desk-form-row">
                      <label htmlFor={`lot-container-${index}`}>Container</label>
                      <select
                        id={`lot-container-${index}`}
                        value={lot.containerId}
                        onChange={(e) =>
                          updateLot(index, { containerId: e.target.value })
                        }
                      >
                        <option value="">No container</option>
                        {containers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.name}
                            {c.cost > 0
                              ? ` (${((c.totalDuty / c.cost) * 100).toFixed(2)}% customs)`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="desk-form-row">
                      <label htmlFor={`lot-qty-${index}`}>Qty</label>
                      <input
                        id={`lot-qty-${index}`}
                        type="number"
                        min="0"
                        value={lot.quantity}
                        onChange={(e) =>
                          setLotRows((rows) =>
                            rows.map((row, i) =>
                              i === index
                                ? { ...row, quantity: e.target.value }
                                : row
                            )
                          )
                        }
                      />
                    </div>
                    <div className="desk-form-row">
                      <label htmlFor={`lot-cost-${index}`}>Cost</label>
                      <input
                        id={`lot-cost-${index}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={lot.cost}
                        onChange={(e) => updateLot(index, { cost: e.target.value })}
                      />
                    </div>
                    <div className="desk-form-row">
                      <label htmlFor={`lot-duty-${index}`}>Customs each</label>
                      <input
                        id={`lot-duty-${index}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={lot.customsDuty}
                        readOnly={Boolean(lot.containerId)}
                        onChange={(e) =>
                          updateLot(index, { customsDuty: e.target.value })
                        }
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {(() => {
                        const container = containers.find(
                          (item) => item.id === lot.containerId
                        );
                        if (!container) {
                          return "Choose a container. Customs each is the item cost times that shipment’s customs share.";
                        }
                        if (!(container.cost > 0)) {
                          return "This container has no cost, so customs each stays 0.";
                        }
                        const share = (container.totalDuty / container.cost) * 100;
                        return `Calculated: $${Number(lot.cost || 0).toFixed(2)} × ${share.toFixed(2)}% = $${Number(lot.customsDuty || 0).toFixed(2)} each.`;
                      })()}
                    </p>
                    </div>
                ))}
              </div>
            ) : null}
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
          {fullItemForm ? (
          <fieldset className="desk-fieldset">
            <legend>Financial</legend>
            <div className="desk-form-row">
              <label>Next sale cost</label>
              <input
                readOnly
                value={(Number(lotRows[0]?.cost || 0)).toFixed(2)}
              />
            </div>
            <div className="desk-form-row">
              <label>Next sale customs</label>
              <input
                readOnly
                value={(Number(lotRows[0]?.customsDuty || 0)).toFixed(2)}
              />
            </div>
            <div className="desk-form-row">
              <label>Next sale landed cost</label>
              <input
                readOnly
                value={(
                  Number(lotRows[0]?.cost || 0) +
                  Number(lotRows[0]?.customsDuty || 0)
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
              <label htmlFor="online-price">Online Price</label>
              <input
                id="online-price"
                type="number"
                step="0.01"
                min="0"
                value={form.onlinePrice}
                onChange={(e) => setField("onlinePrice", e.target.value)}
                placeholder=""
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="max-discount">Max discount %</label>
              <input
                id="max-discount"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.maxDiscountPercent}
                onChange={(e) => setField("maxDiscountPercent", e.target.value)}
                placeholder=""
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Leave this empty and the item takes the full receipt discount.
              A number is the most percent this item can be reduced, even when
              the receipt qualifies for more.
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Choose the container, then type the cost. Customs each fills in
              from that shipment. The next sale uses the oldest stock. A later
              shipment sells after that one runs out, at the same price.
            </p>
          </fieldset>
          ) : null}

          <fieldset className="desk-fieldset">
            <legend>Wholesale</legend>
            <p className="mb-2 text-[11px] text-slate-500">
              Most items leave this off. Wholesale for a mixed cart is the %
              in Preferences, with Max discount % as a cap. Fill a wholesale
              price only if this item is always a set wholesale amount, not
              the receipt %.
            </p>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sellWholesale}
                onChange={(e) => {
                  setSellWholesale(e.target.checked);
                }}
              />
              This item can be sold wholesale
            </label>
            {sellWholesale ? (
              <>
                {fullItemForm ? (
                  <div className="desk-form-row">
                    <label htmlFor="wholesale">Wholesale Price (optional)</label>
                    <input
                      id="wholesale"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.wholesalePrice}
                      onChange={(e) =>
                        setField("wholesalePrice", e.target.value)
                      }
                    />
                  </div>
                ) : null}
                <div className="desk-form-row">
                  <label htmlFor="ws-min">Min quantity</label>
                  <input
                    id="ws-min"
                    type="number"
                    min="0"
                    value={form.wholesaleMinQty}
                    onChange={(e) =>
                      setField("wholesaleMinQty", e.target.value)
                    }
                    placeholder=""
                  />
                </div>
                <div className="desk-form-row">
                  <label htmlFor="ws-max">Max quantity</label>
                  <input
                    id="ws-max"
                    type="number"
                    min="0"
                    value={form.wholesaleMaxQty}
                    onChange={(e) =>
                      setField("wholesaleMaxQty", e.target.value)
                    }
                    placeholder="0 = no max"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  In POS the cashier selects this line and presses Fixed WS
                  Price. That line uses the wholesale price and skips the
                  receipt %. Min/max quantity apply only then.
                </p>
              </>
            ) : null}
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
          {printLabel ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor="label-copies" className="text-sm">
                Copies
              </label>
              <input
                id="label-copies"
                type="number"
                min="1"
                max="200"
                className="w-20"
                value={labelCopies}
                onChange={(e) => setLabelCopies(e.target.value)}
              />
              <button
                type="button"
                className="desk-btn"
                disabled={printingLabel}
                onClick={() => printStickers(Number(labelCopies) || 1)}
              >
                {printingLabel
                  ? "Printing…"
                  : `Print ${Math.min(200, Math.max(1, Math.floor(Number(labelCopies) || 1)))} label${Math.min(200, Math.max(1, Math.floor(Number(labelCopies) || 1))) === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {printLabel ? (
        <div className="label-sheet mt-3">
          <div className="label">
            <div className="label-name">{printLabel.name}</div>
            <div className="label-price">{formatUsd(printLabel.price)}</div>
            <Barcode value={printLabel.barcode} />
            <div className="label-code">{printLabel.barcode}</div>
          </div>
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
            setPrintLabel(null);
            setScanHint(
              "Type the name and price. Put the barcode you want on the item, or leave barcode empty and the system creates one."
            );
            router.push("/items/new");
            setTimeout(() => nameRef.current?.focus(), 50);
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
          onClick={() => router.push(homeHref)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
