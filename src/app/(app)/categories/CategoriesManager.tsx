"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

type Category = {
  id: string;
  name: string;
  _count: { products: number };
};

export function CategoriesManager({
  initialCategories,
}: {
  initialCategories: Category[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialCategories);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create category");
      return;
    }
    const category = data.category as Category;
    setRows((current) => [
      ...current.filter((row) => row.id !== category.id),
      { ...category, _count: category._count || { products: 0 } },
    ]);
    setName("");
    router.refresh();
  }

  async function removeCategory(id: string) {
    if (!confirm("Delete this category?")) return;
    const previous = rows;
    setRows((current) => current.filter((row) => row.id !== id));
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      if (res.status < 500) {
        setRows(previous);
        const data = await res.json();
        alert(data.error || "Could not delete");
      }
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <form onSubmit={createCategory} className="flex flex-col gap-2 sm:flex-row">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            Add category
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </Panel>
      <Panel>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Products</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td>{category._count.products}</td>
                <td>
                  <button
                    onClick={() => removeCategory(category.id)}
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
