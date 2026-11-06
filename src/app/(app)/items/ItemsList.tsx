"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { downloadExcelCsv } from "@/lib/exportCsv";

export type ItemRow = {
  id: string;
  createdById?: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  wholesalePrice: number;
  onlinePrice?: number;
  retailPrice?: number;
  cost: number;
  customsDuty: number;
  stock: number;
  lowStockAt: number;
  active: boolean;
  showInPos: boolean;
  categoryName: string | null;
  containerCode: string | null;
};

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function ItemsList({
  initialItems,
  canManage = true,
  viewOnly = false,
  viewerId = "",
}: {
  initialItems: ItemRow[];
  canManage?: boolean;
  viewOnly?: boolean;
  viewerId?: string;
}) {
  const router = useRouter();
  const lookRef = useRef<HTMLInputElement>(null);
  const [lookFor, setLookFor] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.id ?? null
  );
  const [hint, setHint] = useState(
    viewOnly
      ? "Search by name, code, or barcode."
      : canManage
        ? "Scan a barcode in Look For, or click New to add an item."
        : "Select an item you added, then click Correct to fix the name, price, or barcode."
  );

  useEffect(() => {
    if (viewOnly) return;
    lookRef.current?.focus();
  }, [viewOnly]);

  const items = useMemo(() => {
    const q = lookFor.trim().toLowerCase();
    if (!q) return initialItems;
    return initialItems.filter((item) => {
      const hay = [
        item.name,
        item.sku || "",
        item.barcode || "",
        item.categoryName || "",
        item.containerCode || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [initialItems, lookFor]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`tr[data-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, items]);

  function handleScanOrSearch() {
    const term = lookFor.trim();
    if (!term) {
      setHint("Scan a barcode in Look For, or click New to add an item.");
      return;
    }

    const exact = initialItems.find(
      (item) =>
        (item.barcode && item.barcode.toLowerCase() === term.toLowerCase()) ||
        (item.sku && item.sku.toLowerCase() === term.toLowerCase())
    );

    if (exact) {
      setSelectedId(exact.id);
      setLookFor(exact.barcode || exact.sku || exact.name);
      setHint(`Selected: ${exact.name}. Click the item to open it.`);
      requestAnimationFrame(() => lookRef.current?.select());
      return;
    }

    const q = term.toLowerCase();
    const matches = initialItems.filter((item) =>
      [item.name, item.sku || "", item.barcode || "", item.categoryName || "", item.containerCode || ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    if (matches.length > 0) {
      setSelectedId(matches[0].id);
      setHint(
        matches.length === 1
          ? `Showing ${matches[0].name}.`
          : `Showing ${matches.length} items.`
      );
      return;
    }

    setHint(
      viewOnly
        ? "No matching item."
        : "No item with this barcode. Opening New Item with barcode filled."
    );
    if (!viewOnly) {
      router.push(`/items/new?barcode=${encodeURIComponent(term)}`);
    }
  }

  async function removeSelected() {
    if (!selectedId) return;
    if (
      !confirm(
        "OWNER ONLY\n\nDelete this item permanently?\nIf it was sold before, deletion may fail.\nCashiers cannot delete items."
      )
    ) {
      return;
    }
    const res = await fetch(`/api/products/${selectedId}`, { method: "DELETE" });
    if (!res.ok && res.status < 500) {
      const data = await res.json();
      alert(data.error || "Could not remove item");
      return;
    }
    router.refresh();
  }

  function exportExcel() {
    downloadExcelCsv(
      `items-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Barcode",
        "Item Code",
        "Item Name",
        "Category",
        "Container",
        "Unit",
        "On Hand Qty",
        "Normal Price",
        "Wholesale Price",
        "Cost",
        "Customs Duty",
        "Landed Cost",
        "Show in POS",
        "Active",
      ],
      items.map((item) => [
        item.barcode || "",
        item.sku || "",
        item.name,
        item.categoryName || "",
        item.containerCode || "",
        item.unit,
        item.stock,
        item.price,
        item.wholesalePrice,
        item.cost,
        item.customsDuty,
        item.cost + item.customsDuty,
        item.showInPos ? "Yes" : "No",
        item.active ? "Yes" : "No",
      ])
    );
  }

  return (
    <div className="desk-panel">
      <div className="desk-toolbar">
        <div className="desk-field" style={{ minWidth: 280, flex: 1 }}>
          <label htmlFor="look-for">Look For / Scan Barcode</label>
          <input
            id="look-for"
            ref={lookRef}
            value={lookFor}
            onChange={(e) => setLookFor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScanOrSearch();
              }
            }}
            placeholder="Scan barcode or type name"
            autoComplete="off"
          />
        </div>
        <button type="button" className="desk-btn" onClick={handleScanOrSearch}>
          Fill
        </button>
      </div>

      <div className="mb-2 border border-[#9bb4cc] bg-[#eef5ff] px-3 py-2 text-xs">
        {hint}
      </div>

      {viewOnly ? (
        <div className="item-cards">
          {items.length === 0 ? (
            <p>No items found.</p>
          ) : (
            items.map((item) => (
              <article key={item.id} className="sale-card">
                <div className="sale-card-top">
                  <strong>{item.name}</strong>
                  <span>${formatAmount(item.price)}</span>
                </div>
                <div className="sale-card-meta">
                  Stock {item.stock.toFixed(1)} {item.unit}
                  {item.stock <= item.lowStockAt ? " · Low stock" : ""}
                  {item.categoryName ? ` · ${item.categoryName}` : ""}
                  {item.containerCode ? ` · ${item.containerCode}` : ""}
                </div>
                <div className="sale-card-meta">
                  {item.barcode || "No barcode"}
                  {item.sku ? ` · ${item.sku}` : ""}
                  {item.wholesalePrice > 0
                    ? ` · Wholesale $${formatAmount(item.wholesalePrice)}`
                    : ""}
                  {(item.onlinePrice || 0) > 0
                    ? ` · Online $${formatAmount(item.onlinePrice || 0)}`
                    : ""}
                  {(item.retailPrice || 0) > 0
                    ? ` · Retail $${formatAmount(item.retailPrice || 0)}`
                    : ""}
                  {item.active ? "" : " · Inactive"}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}

      {viewOnly ? null : (
      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Barcode</th>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>Category</th>
              <th>Containers</th>
              <th>U.O.M</th>
              <th>On Hand Qty</th>
              <th>Normal Price</th>
              <th>Wholesale</th>
              {canManage ? (
                <>
                  <th>Cost</th>
                  <th>Customs</th>
                  <th>Landed</th>
                </>
              ) : null}
              <th>POS</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 15 : 12}>No items found.</td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr
                  key={item.id}
                  data-id={item.id}
                  data-selected={selectedId === item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    router.push(`/items/${item.id}`);
                  }}
                >
                  <td>{index + 1}</td>
                  <td>{item.barcode || "—"}</td>
                  <td>{item.sku || "—"}</td>
                  <td>{item.name}</td>
                  <td>{item.categoryName || "—"}</td>
                  <td>{item.containerCode || "—"}</td>
                  <td>{item.unit}</td>
                  <td className="report-amount">{item.stock.toFixed(1)}</td>
                  <td className="report-amount">{formatAmount(item.price)}</td>
                  <td className="report-amount">
                    {formatAmount(item.wholesalePrice)}
                  </td>
                  {canManage ? (
                    <>
                      <td className="report-amount">{formatAmount(item.cost)}</td>
                      <td className="report-amount">
                        {formatAmount(item.customsDuty)}
                      </td>
                      <td className="report-amount">
                        {formatAmount(item.cost + item.customsDuty)}
                      </td>
                    </>
                  ) : null}
                  <td>{item.showInPos ? "Yes" : "No"}</td>
                  <td>{item.active ? "Yes" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      <div className="desk-actions">
        {viewOnly ? null : (
          <>
        <Link href="/items/new" className="desk-btn" prefetch={false}>
          New
        </Link>
        <Link href="/items/labels" className="desk-btn" prefetch={false}>
          Barcode labels
        </Link>
        {canManage ? (
          <>
            <Link href="/items/containers" className="desk-btn" prefetch={false}>
              Containers
            </Link>
            {selectedId ? (
              <Link
                href={`/items/${selectedId}`}
                className="desk-btn"
                prefetch={false}
              >
                Edit
              </Link>
            ) : (
              <button type="button" className="desk-btn" disabled>
                Edit
              </button>
            )}
            <button
              type="button"
              className="desk-btn"
              disabled={!selectedId}
              onClick={removeSelected}
            >
              Remove
            </button>
          </>
        ) : initialItems.some(
            (item) => item.id === selectedId && item.createdById === viewerId
          ) ? (
          <Link href={`/items/${selectedId}`} className="desk-btn" prefetch={false}>
            Correct
          </Link>
        ) : (
          <button type="button" className="desk-btn" disabled>
            Correct
          </button>
        )}
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.refresh()}
        >
          Refresh
        </button>
        <button
          type="button"
          className="desk-btn"
          onClick={() => window.print()}
        >
          Print
        </button>
        <button type="button" className="desk-btn" onClick={exportExcel}>
          Excel
        </button>
          </>
        )}
      </div>
    </div>
  );
}
