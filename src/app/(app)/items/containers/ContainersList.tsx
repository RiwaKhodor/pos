"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { downloadExcelCsv } from "@/lib/exportCsv";

export type ContainerItem = {
  productId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  cost: number;
  customsDuty: number;
};

export type ContainerRow = {
  id: string;
  code: string;
  name: string;
  note: string | null;
  arrivedAt: string | null;
  cost: number;
  totalDuty: number;
  itemCount: number;
  items: ContainerItem[];
};

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export function ContainersList({
  initialContainers,
}: {
  initialContainers: ContainerRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialContainers);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialContainers[0]?.id ?? null
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRows(initialContainers);
  }, [initialContainers]);

  const selected = rows.find((c) => c.id === selectedId) || null;

  const containers = rows.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.note || "").toLowerCase().includes(q)
    );
  });

  async function removeSelected() {
    if (!selectedId) return;
    if (
      !confirm(
        "Delete this container?\nItems stay in inventory — they just become unassigned."
      )
    ) {
      return;
    }
    const removedId = selectedId;
    setRows((current) => current.filter((row) => row.id !== removedId));
    setSelectedId(null);
    const res = await fetch(`/api/containers/${removedId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status < 500) {
        setRows(initialContainers);
        alert(data.error || "Could not delete container");
      }
      return;
    }
    router.refresh();
  }

  async function removeItem(productId: string, name: string) {
    if (!selected) return;
    if (!confirm(`Remove ${name} from ${selected.code}? The item stays in the store.`)) {
      return;
    }
    const res = await fetch(`/api/containers/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: [{ productId, quantity: 0, cost: 0, customsDuty: 0 }],
      }),
    });
    if (!res.ok && res.status < 500) {
      const data = await res.json();
      alert(data.error || "Could not remove item");
      return;
    }
    router.refresh();
  }

  function exportExcel() {
    downloadExcelCsv(
      `containers-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Code", "Name", "Items", "Cost", "Total Customs", "Customs %", "Arrived", "Note"],
      containers.map((c) => [
        c.code,
        c.name,
        c.itemCount,
        c.cost,
        c.totalDuty,
        c.cost > 0 ? (c.totalDuty / c.cost) * 100 : 0,
        c.arrivedAt || "",
        c.note || "",
      ])
    );
  }

  return (
    <div className="desk-panel">
      <div className="desk-toolbar">
        <div className="desk-field" style={{ minWidth: 280, flex: 1 }}>
          <label htmlFor="container-look">Look For</label>
          <input
            id="container-look"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Code or name"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mb-2 border border-[#9bb4cc] bg-[#eef5ff] px-3 py-2 text-xs">
        Click a container to see its cost, customs, and items. Add items on the
        New Item page and choose the container there.
      </div>

      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Items</th>
              <th>Cost</th>
              <th>Total Customs</th>
              <th>Customs %</th>
              <th>Arrived</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {containers.length === 0 ? (
              <tr>
                <td colSpan={8}>No containers yet.</td>
              </tr>
            ) : (
              containers.map((c) => (
                <tr
                  key={c.id}
                  data-selected={selectedId === c.id}
                  onClick={() => setSelectedId(c.id)}
                >
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td className="report-amount">{c.itemCount}</td>
                  <td className="report-amount">{formatAmount(c.cost)}</td>
                  <td className="report-amount">{formatAmount(c.totalDuty)}</td>
                  <td className="report-amount">
                    {c.cost > 0
                      ? `${formatAmount((c.totalDuty / c.cost) * 100)}%`
                      : "—"}
                  </td>
                  <td>{formatDate(c.arrivedAt)}</td>
                  <td>{c.note || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="mt-3 border border-[#9bb4cc] bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-[#d5e3f2] bg-[#eef5ff] px-3 py-2">
            <div className="text-sm font-bold">
              {selected.code} — {selected.name}
            </div>
            <button
              type="button"
              className="desk-btn"
              onClick={() => router.push(`/items/containers/${selected.id}`)}
            >
              Edit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3 py-2 text-xs md:grid-cols-4">
            <div>
              Container cost
              <div className="font-semibold">{formatAmount(selected.cost)}</div>
            </div>
            <div>
              Total customs
              <div className="font-semibold">
                {formatAmount(selected.totalDuty)}
              </div>
            </div>
            <div>
              Customs %
              <div className="font-semibold">
                {selected.cost > 0
                  ? `${formatAmount((selected.totalDuty / selected.cost) * 100)}%`
                  : "—"}
              </div>
            </div>
            <div>
              Arrived
              <div className="font-semibold">{formatDate(selected.arrivedAt)}</div>
            </div>
          </div>
          <table className="desk-grid">
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th>Barcode</th>
                <th>Qty</th>
                <th>Cost</th>
                <th>Customs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {selected.items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    No items in this container yet. Add them from New Item and
                    choose this container.
                  </td>
                </tr>
              ) : (
                selected.items.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.name}</td>
                    <td>{item.sku || "—"}</td>
                    <td>{item.barcode || "—"}</td>
                    <td className="report-amount">{item.quantity}</td>
                    <td className="report-amount">{formatAmount(item.cost)}</td>
                    <td className="report-amount">
                      {formatAmount(item.customsDuty)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="desk-btn"
                        onClick={() => router.push(`/items/${item.productId}`)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="desk-btn"
                        onClick={() => removeItem(item.productId, item.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="desk-actions">
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/containers/new")}
        >
          New
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={!selectedId}
          onClick={() =>
            selectedId && router.push(`/items/containers/${selectedId}`)
          }
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
        <button type="button" className="desk-btn" onClick={exportExcel}>
          Excel
        </button>
      </div>
    </div>
  );
}
