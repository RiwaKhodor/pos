"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { downloadExcelCsv } from "@/lib/exportCsv";

export type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  wholesalePrice: number;
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

export function ItemsList({ initialItems }: { initialItems: ItemRow[] }) {
  const router = useRouter();
  const lookRef = useRef<HTMLInputElement>(null);
  const [lookFor, setLookFor] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.id ?? null
  );
  const [hint, setHint] = useState(
    "Scan a barcode in Look For, or click New to add an item."
  );

  useEffect(() => {
    lookRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
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
  }, [initialItems, query]);

  function handleScanOrSearch() {
    const term = lookFor.trim();
    setQuery(term);
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
      setHint(`Found: ${exact.name}. Opening item…`);
      router.push(`/items/${exact.id}`);
      return;
    }

    setHint("No item with this barcode. Opening New Item with barcode filled.");
    router.push(`/items/new?barcode=${encodeURIComponent(term)}`);
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
    if (!res.ok) {
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

      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Barcode</th>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>Category</th>
              <th>Container</th>
              <th>U.O.M</th>
              <th>On Hand Qty</th>
              <th>Normal Price</th>
              <th>Wholesale</th>
              <th>Cost</th>
              <th>Customs</th>
              <th>Landed</th>
              <th>POS</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={15}>No items found.</td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr
                  key={item.id}
                  data-selected={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                  onDoubleClick={() => router.push(`/items/${item.id}`)}
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
                  <td className="report-amount">{formatAmount(item.cost)}</td>
                  <td className="report-amount">
                    {formatAmount(item.customsDuty)}
                  </td>
                  <td className="report-amount">
                    {formatAmount(item.cost + item.customsDuty)}
                  </td>
                  <td>{item.showInPos ? "Yes" : "No"}</td>
                  <td>{item.active ? "Yes" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="desk-actions">
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/new")}
        >
          New
        </button>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/containers")}
        >
          Containers
        </button>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/container-customs")}
        >
          Container Customs
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={!selectedId}
          onClick={() => selectedId && router.push(`/items/${selectedId}`)}
        >
          Edit
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={!selectedId}
          onClick={removeSelected}
        >
          Remove
        </button>
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
      </div>
    </div>
  );
}
