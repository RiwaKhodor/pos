"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { customsFromContainer } from "@/lib/container-duty";

export type ProductLotPick = {
  containerId: string | null;
  containerCode: string | null;
  quantity: number;
  cost: number;
  customsDuty: number;
};

export type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  cost: number;
  customsDuty: number;
  lots: ProductLotPick[];
};

export type ContainerFormValues = {
  id?: string;
  code: string;
  name: string;
  note: string;
  arrivedAt: string;
  cost: string;
  totalDuty: string;
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
    cost: initial?.cost || "0",
    totalDuty: initial?.totalDuty || "0",
  });
  const [lines, setLines] = useState<
    Record<string, { quantity: string; cost: string; customsDuty: string }>
  >(() => {
    const drafts: Record<
      string,
      { quantity: string; cost: string; customsDuty: string }
    > = {};
    for (const product of products) {
      const here = product.lots.filter(
        (lot) => initial?.id && lot.containerId === initial.id
      );
      const qty = here.reduce((sum, lot) => sum + lot.quantity, 0);
      const first = here[0];
      drafts[product.id] = {
        quantity: qty > 0 ? String(qty) : "",
        cost: first ? String(first.cost) : String(product.cost || 0),
        customsDuty: first
          ? String(first.customsDuty)
          : String(product.customsDuty || 0),
      };
    }
    return drafts;
  });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inThisContainer = useMemo(
    () =>
      products.filter((product) => Number(lines[product.id]?.quantity || 0) > 0)
        .length,
    [products, lines]
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

  function dutyEach(cost: string, containerCost = form.cost, totalDuty = form.totalDuty) {
    return String(
      customsFromContainer(Number(cost) || 0, {
        cost: Number(containerCost) || 0,
        totalDuty: Number(totalDuty) || 0,
      })
    );
  }

  function setLine(
    id: string,
    patch: Partial<{ quantity: string; cost: string; customsDuty: string }>
  ) {
    setLines((prev) => {
      const next = { ...prev[id], ...patch };
      if (patch.cost !== undefined) next.customsDuty = dutyEach(next.cost);
      return { ...prev, [id]: next };
    });
  }

  function setContainerMoney(patch: { cost?: string; totalDuty?: string }) {
    const cost = patch.cost ?? form.cost;
    const totalDuty = patch.totalDuty ?? form.totalDuty;
    setForm({ ...form, cost, totalDuty });
    setLines((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], customsDuty: dutyEach(next[id].cost, cost, totalDuty) };
      }
      return next;
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
      cost: Number(form.cost || 0),
      totalDuty: Number(form.totalDuty || 0),
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
    router.push("/items/containers");
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
        {mode === "create"
          ? "Enter the container cost and customs. Items are added later on the New Item page — choose this container in the dropdown there."
          : "Change the container code, cost, or customs. Items already in it keep their cost, and their customs percent updates from this bill."}
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
              <label htmlFor="c-cost">Container Cost</label>
              <input
                id="c-cost"
                type="number"
                step="0.01"
                min="0"
                value={form.cost}
                onChange={(e) => setContainerMoney({ cost: e.target.value })}
              />
            </div>
            <div className="desk-form-row">
              <label htmlFor="c-duty">Total Customs</label>
              <input
                id="c-duty"
                type="number"
                step="0.01"
                min="0"
                value={form.totalDuty}
                onChange={(e) => setContainerMoney({ totalDuty: e.target.value })}
              />
            </div>
            <div className="desk-form-row">
              <label>Customs %</label>
              <input
                readOnly
                value={
                  Number(form.cost) > 0
                    ? `${((Number(form.totalDuty || 0) / Number(form.cost)) * 100).toFixed(2)}% of each item cost`
                    : "Enter container cost"
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

        {mode === "create" || products.length === 0 ? (
          <div className="desk-form-grid">
            <fieldset className="desk-fieldset">
              <legend>Items in this container</legend>
              <div className="px-1 py-2 text-xs leading-5">
                {mode === "create"
                  ? "Nothing is in this container yet. Save it, then add each item from New Item and pick this container in the dropdown."
                  : "Items stay on the container list. Change the fields above, then save."}
              </div>
            </fieldset>
          </div>
        ) : (
        <div className="desk-form-grid">
          <fieldset className="desk-fieldset">
            <legend>Items in this container ({inThisContainer})</legend>
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
                  const line = lines[p.id] || {
                    quantity: "",
                    cost: "0",
                    customsDuty: "0",
                  };
                  const others = p.lots
                    .filter(
                      (lot) =>
                        lot.quantity > 0 && lot.containerId !== form.id
                    )
                    .map(
                      (lot) =>
                        `${lot.containerCode || "No container"} (${lot.quantity})`
                    )
                    .join(", ");
                  return (
                    <div
                      key={p.id}
                      className="border-b border-[#eee] px-3 py-2 text-xs"
                    >
                      <div className="mb-1 font-semibold">
                        {p.name}
                        {p.sku ? ` · ${p.sku}` : ""}
                      </div>
                      {others ? (
                        <div className="mb-1 text-slate-500">
                          Also in {others}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-3 gap-2">
                        <label>
                          Qty here
                          <input
                            type="number"
                            min="0"
                            value={line.quantity}
                            onChange={(e) =>
                              setLine(p.id, { quantity: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Cost
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.cost}
                            onChange={(e) =>
                              setLine(p.id, { cost: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Customs
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            readOnly
                            value={line.customsDuty}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </fieldset>
        </div>
        )}
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
