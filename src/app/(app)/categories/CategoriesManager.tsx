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
    setName("");
    router.refresh();
  }

  async function removeCategory(id: string) {
    if (!confirm("Delete this category?")) return;
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Could not delete");
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
            {initialCategories.map((category) => (
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
