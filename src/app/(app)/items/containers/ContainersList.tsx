"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadExcelCsv } from "@/lib/exportCsv";

export type ContainerRow = {
  id: string;
  code: string;
  name: string;
  note: string | null;
  arrivedAt: string | null;
  totalDuty: number;
  itemCount: number;
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
  const [selectedId, setSelectedId] = useState<string | null>(
    initialContainers[0]?.id ?? null
  );
  const [query, setQuery] = useState("");

  const containers = initialContainers.filter((c) => {
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
    const res = await fetch(`/api/containers/${selectedId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Could not delete container");
      return;
    }
    router.refresh();
  }

  function exportExcel() {
    downloadExcelCsv(
      `containers-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Code", "Name", "Items", "Total Duty", "Arrived", "Note"],
      containers.map((c) => [
        c.code,
        c.name,
        c.itemCount,
        c.totalDuty,
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
        Create a container, put items in it, or leave items with no container.
      </div>

      <div className="desk-grid-wrap">
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Items</th>
              <th>Total Duty</th>
              <th>Arrived</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {containers.length === 0 ? (
              <tr>
                <td colSpan={6}>No containers yet.</td>
              </tr>
            ) : (
              containers.map((c) => (
                <tr
                  key={c.id}
                  data-selected={selectedId === c.id}
                  onClick={() => setSelectedId(c.id)}
                  onDoubleClick={() => router.push(`/items/containers/${c.id}`)}
                >
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td className="report-amount">{c.itemCount}</td>
                  <td className="report-amount">{formatAmount(c.totalDuty)}</td>
                  <td>{formatDate(c.arrivedAt)}</td>
                  <td>{c.note || "—"}</td>
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
          Open
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={!selectedId}
          onClick={() =>
            selectedId &&
            router.push(
              `/items/container-customs?containerId=${encodeURIComponent(selectedId)}`
            )
          }
        >
          Allocate Customs
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
