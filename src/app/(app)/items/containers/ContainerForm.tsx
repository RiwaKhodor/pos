"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  containerId: string | null;
  containerCode: string | null;
};

export type ContainerFormValues = {
  id?: string;
  code: string;
  name: string;
  note: string;
  arrivedAt: string;
  totalDuty: string;
  productIds: string[];
};

export function ContainerForm({
  mode,
  products,
  initial,
}: {
  mode: "create" | "edit";
  products: ProductPick[];
  initial?: Partial<ContainerFormValues>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ContainerFormValues>({
    id: initial?.id,
    code: initial?.code || "",
    name: initial?.name || "",
    note: initial?.note || "",
    arrivedAt: initial?.arrivedAt || "",
    totalDuty: initial?.totalDuty || "0",
    productIds: initial?.productIds || [],
  });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => new Set(form.productIds),
    [form.productIds]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
      );
    });
  }, [products, filter]);

  function toggleProduct(id: string) {
    setForm((prev) => {
      const has = prev.productIds.includes(id);
      return {
        ...prev,
        productIds: has
          ? prev.productIds.filter((x) => x !== id)
          : [...prev.productIds, id],
      };
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload = {
      code: form.code,
      name: form.name,
      note: form.note || null,
      arrivedAt: form.arrivedAt || null,
      totalDuty: Number(form.totalDuty || 0),
      productIds: form.productIds,
    };

    const res = await fetch(
      mode === "create" ? "/api/containers" : `/api/containers/${form.id}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
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
    router.push(`/items/containers/${data.container.id}`);
    router.refresh();
  }

  async function removeContainer() {
    if (!form.id) return;
    if (
      !confirm(
        "Delete this container?\nItems stay in inventory — they just become unassigned."
      )
    ) {
      return;
    }
    const res = await fetch(`/api/containers/${form.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Could not delete");
      return;
    }
    router.push("/items/containers");
    router.refresh();
  }

  return (
    <form className="desk-panel" onSubmit={save}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          {mode === "create" ? "New Container" : `Container: ${form.code}`}
        </div>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/containers")}
        >
          Close
        </button>
      </div>

      <div className="mb-2 border border-[#9bb4cc] bg-[#eef5ff] px-3 py-2 text-xs">
        Tick items that arrived in this container. Leave unticked for items not
        related to any container.
      </div>

      <div className="item-form-layout">
        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Container</legend>
            <div className="desk-form-row">
              <label htmlFor="c-code">Code</label>
              <input
                id="c-code"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. CNT-001"
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="c-name">Name</label>
              <input
                id="c-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. March shipment"
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="c-arrived">Arrived</label>
              <input
                id="c-arrived"
                type="date"
                value={form.arrivedAt}
                onChange={(e) =>
                  setForm({ ...form, arrivedAt: e.target.value })
                }
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="c-duty">Total Duty</label>
              <input
                id="c-duty"
                type="number"
                step="0.01"
                value={form.totalDuty}
                onChange={(e) =>
                  setForm({ ...form, totalDuty: e.target.value })
                }
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="c-note">Note</label>
              <textarea
                id="c-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </fieldset>
        </div>

        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Items in this container ({form.productIds.length})</legend>
            <div className="desk-form-row">
              <label htmlFor="c-filter">Filter</label>
              <input
                id="c-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search item name / code"
              />
            </div>
            <div className="mt-2 max-h-80 overflow-auto border border-[#aaa] bg-white">
              {visible.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">
                  No items match.
                </div>
              ) : (
                visible.map((p) => {
                  const other =
                    p.containerId &&
                    p.containerId !== form.id &&
                    p.containerCode
                      ? ` (now in ${p.containerCode})`
                      : "";
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-[#eee] px-3 py-1.5 text-xs hover:bg-[#f5f8fc]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleProduct(p.id)}
                      />
                      <span className="flex-1">
                        {p.name}
                        {p.sku ? ` · ${p.sku}` : ""}
                        {other}
                      </span>
                      <span className="text-slate-500">qty {p.stock}</span>
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>
        </div>
      </div>

      {error ? (
        <div className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="desk-actions">
        <button type="submit" className="desk-btn" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {mode === "edit" && form.id ? (
          <>
            <button
              type="button"
              className="desk-btn"
              onClick={() =>
                router.push(
                  `/items/new?containerId=${encodeURIComponent(form.id!)}`
                )
              }
            >
              New Item in Container
            </button>
            <button
              type="button"
              className="desk-btn"
              onClick={() =>
                router.push(
                  `/items/container-customs?containerId=${encodeURIComponent(form.id!)}`
                )
              }
            >
              Allocate Customs
            </button>
            <button
              type="button"
              className="desk-btn"
              onClick={removeContainer}
            >
              Delete Container
            </button>
          </>
        ) : null}
      </div>
    </form>
  );
}
