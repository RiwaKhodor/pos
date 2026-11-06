"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock: number;
  lowStockAt: number;
  categoryName: string | null;
  containerName: string | null;
};

export function InventoryManager({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const [hitId, setHitId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        (p.containerName || "").toLowerCase().includes(q)
      );
    });
  }, [products, query]);

  function findMatch(raw: string) {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    return (
      products.find(
        (p) =>
          (p.barcode || "").toLowerCase() === q ||
          (p.sku || "").toLowerCase() === q ||
          p.name.toLowerCase() === q ||
          (p.containerName || "").toLowerCase() === q
      ) ||
      products.find(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q) ||
          (p.barcode || "").toLowerCase().includes(q) ||
          (p.containerName || "").toLowerCase().includes(q)
      ) ||
      null
    );
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const match = findMatch(query);
    setHitId(match?.id ?? null);
    if (!match) return;
    setQuery(match.barcode || match.sku || match.name);
  }

  return (
    <Panel>
      <form className="desk-toolbar" onSubmit={onSearch}>
        <div className="desk-field" style={{ minWidth: 280, flex: 1 }}>
          <label htmlFor="stock-look">Scan / search</label>
          <input
            id="stock-look"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitId(null);
            }}
            placeholder="Scan barcode, or type name / barcode"
            autoComplete="off"
            autoFocus
          />
        </div>
        <button type="submit" className="desk-btn">
          Find
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Barcode</th>
            <th>Category</th>
            <th>Container</th>
            <th>Threshold</th>
            <th>Stock</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={6}>No item matches that name or barcode.</td>
            </tr>
          ) : (
            shown.map((product) => {
              const low = product.stock <= product.lowStockAt;
              return (
                <tr
                  key={product.id}
                  className={hitId === product.id ? "bg-[#d6e6f8]" : undefined}
                >
                  <td>
                    <Link
                      href={`/items/${product.id}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {product.name}
                    </Link>
                    {product.sku ? (
                      <div className="text-xs text-slate-500">{product.sku}</div>
                    ) : null}
                    {low ? (
                      <div className="text-xs text-amber-700">Low stock</div>
                    ) : null}
                  </td>
                  <td>{product.barcode || "—"}</td>
                  <td>{product.categoryName || "—"}</td>
                  <td>{product.containerName || "—"}</td>
                  <td>{product.lowStockAt}</td>
                  <td className="font-medium">{product.stock}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Panel>
  );
}
