"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  cost: number;
  stock: number;
  lowStockAt: number;
  active: boolean;
  categoryId: string | null;
  categoryName: string | null;
};

export function ProductsManager({
  initialProducts,
  categories,
  formatMoney,
}: {
  initialProducts: Product[];
  categories: Category[];
  formatMoney: (n: number) => string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    sku: "",
    price: "",
    cost: "",
    stock: "0",
    lowStockAt: "5",
    categoryId: "",
  });

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        sku: form.sku || null,
        price: Number(form.price),
        cost: Number(form.cost || 0),
        stock: Number(form.stock || 0),
        lowStockAt: Number(form.lowStockAt || 5),
        categoryId: form.categoryId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create product");
      return;
    }
    setForm({
      name: "",
      sku: "",
      price: "",
      cost: "",
      stock: "0",
      lowStockAt: "5",
      categoryId: "",
    });
    router.refresh();
  }

  async function toggleActive(product: Product) {
    await fetch(`/api/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !product.active }),
    });
    router.refresh();
  }

  async function removeProduct(id: string) {
    if (!confirm("Delete this product?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Could not delete product");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-700">
          Add product
        </h2>
        <form
          onSubmit={createProduct}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="SKU"
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            placeholder="Price"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Cost"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Stock"
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-2 lg:col-span-3">
            Create product
          </button>
        </form>
        {error ? (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        ) : null}
      </Panel>

      <Panel>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Price</th>
              <th>Cost</th>
              <th>Stock</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {initialProducts.map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{product.sku || "—"}</td>
                <td>{product.categoryName || "—"}</td>
                <td>{formatMoney(product.price)}</td>
                <td>{formatMoney(product.cost)}</td>
                <td>{product.stock}</td>
                <td>{product.active ? "Active" : "Inactive"}</td>
                <td className="space-x-2">
                  <button
                    onClick={() => toggleActive(product)}
                    className="text-xs text-slate-700 underline"
                  >
                    {product.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => removeProduct(product.id)}
                    className="text-xs text-red-600 underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
