"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

type Product = {
  id: string;
  name: string;
  stock: number;
  lowStockAt: number;
  categoryName: string | null;
};

export function InventoryManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(products.map((p) => [p.id, String(p.stock)]))
  );

  async function saveStock(id: string) {
    const stock = Number(drafts[id]);
    if (Number.isNaN(stock) || stock < 0) {
      alert("Enter a valid stock amount");
      return;
    }
    const res = await fetch("/api/inventory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, stock }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Update failed");
      return;
    }
    router.refresh();
  }

  return (
    <Panel>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Threshold</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const low = product.stock <= product.lowStockAt;
            return (
              <tr key={product.id}>
                <td>
                  <div className="font-medium">{product.name}</div>
                  {low ? (
                    <div className="text-xs text-amber-700">Low stock</div>
                  ) : null}
                </td>
                <td>{product.categoryName || "—"}</td>
                <td>{product.lowStockAt}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={drafts[product.id] ?? product.stock}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [product.id]: e.target.value })
                    }
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
                <td>
                  <button
                    onClick={() => saveStock(product.id)}
                    className="text-xs text-slate-700 underline"
                  >
                    Save
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
