"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  cost: number;
  customsDuty: number;
  stock: number;
  containerId: string | null;
};

type ContainerOption = {
  id: string;
  code: string;
  name: string;
  totalDuty: number;
};

type Line = {
  key: string;
  productId: string;
  quantity: string;
};

type Allocation = {
  productId: string;
  name: string;
  quantity: number;
  share: number;
  perUnit: number;
  customsDuty: number;
  landedCost: number;
};

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export function ContainerCustomsForm({
  products,
  containers,
  initialContainerId,
}: {
  products: ProductOption[];
  containers: ContainerOption[];
  initialContainerId?: string;
}) {
  const router = useRouter();
  const [containerId, setContainerId] = useState(initialContainerId || "");
  const [totalDuty, setTotalDuty] = useState("");
  const [mode, setMode] = useState<"value" | "qty">("value");
  const [applyMode, setApplyMode] = useState<"replace" | "add">("replace");
  const [lines, setLines] = useState<Line[]>([
    { key: "1", productId: "", quantity: "1" },
  ]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Allocation[] | null>(null);
  const [saving, setSaving] = useState(false);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  function loadContainer(id: string) {
    setContainerId(id);
    if (!id) return;
    const container = containers.find((c) => c.id === id);
    const members = products.filter((p) => p.containerId === id);
    if (container && container.totalDuty > 0) {
      setTotalDuty(String(container.totalDuty));
    }
    if (members.length === 0) {
      setLines([{ key: "1", productId: "", quantity: "1" }]);
      return;
    }
    setLines(
      members.map((p, i) => ({
        key: `${p.id}-${i}`,
        productId: p.id,
        quantity: String(Math.max(1, p.stock || 1)),
      }))
    );
  }

  useEffect(() => {
    if (initialContainerId) {
      loadContainer(initialContainerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContainerId]);

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: String(Date.now()), productId: "", quantity: "1" },
    ]);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l))
    );
  }

  function removeLine(key: string) {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)
    );
  }

  async function apply() {
    setError("");
    setResult(null);
    setSaving(true);
    const res = await fetch("/api/items/container-customs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalDuty: Number(totalDuty),
        mode,
        applyMode,
        containerId: containerId || null,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
        })),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Failed to allocate customs duty");
      return;
    }
    setResult(data.allocations || []);
    router.refresh();
  }

  return (
    <div className="desk-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">Container Customs Duty</div>
          <p className="mt-1 text-xs text-slate-500">
            Pick a saved container to load its items, or add lines manually.
            Total customs is split onto each item (per unit).
          </p>
        </div>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items/containers")}
        >
          Containers
        </button>
      </div>

      <div className="desk-toolbar mb-3">
        <div className="desk-field" style={{ minWidth: 220 }}>
          <label htmlFor="from-container">Load from container</label>
          <select
            id="from-container"
            value={containerId}
            onChange={(e) => loadContainer(e.target.value)}
          >
            <option value="">Manual (no container)</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="desk-field">
          <label htmlFor="total-duty">Total container customs</label>
          <input
            id="total-duty"
            type="number"
            step="0.01"
            min="0"
            value={totalDuty}
            onChange={(e) => setTotalDuty(e.target.value)}
            placeholder="e.g. 500"
          />
        </div>
        <div className="desk-field">
          <label htmlFor="split-mode">Split by</label>
          <select
            id="split-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "value" | "qty")}
          >
            <option value="value">Item value (cost × qty) — recommended</option>
            <option value="qty">Quantity only</option>
          </select>
        </div>
        <div className="desk-field">
          <label htmlFor="apply-mode">Apply to item</label>
          <select
            id="apply-mode"
            value={applyMode}
            onChange={(e) => setApplyMode(e.target.value as "replace" | "add")}
          >
            <option value="replace">Replace current customs duty</option>
            <option value="add">Add on top of current customs duty</option>
          </select>
        </div>
      </div>

      <div className="desk-grid-wrap mb-3" style={{ minHeight: 160 }}>
        <table className="desk-grid">
          <thead>
            <tr>
              <th>Item in container</th>
              <th>Qty in container</th>
              <th>Current cost</th>
              <th>Current customs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const product = productMap.get(line.productId);
              return (
                <tr key={line.key}>
                  <td>
                    <select
                      value={line.productId}
                      onChange={(e) =>
                        updateLine(line.key, { productId: e.target.value })
                      }
                      style={{ minWidth: 220 }}
                    >
                      <option value="">Select item…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.sku ? ` (${p.sku})` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.key, { quantity: e.target.value })
                      }
                      style={{ width: 90 }}
                    />
                  </td>
                  <td className="report-amount">
                    {product ? formatAmount(product.cost) : "—"}
                  </td>
                  <td className="report-amount">
                    {product ? formatAmount(product.customsDuty) : "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="desk-btn"
                      onClick={() => removeLine(line.key)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="desk-actions mb-3">
        <button type="button" className="desk-btn" onClick={addLine}>
          Add item line
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={saving}
          onClick={apply}
        >
          {saving ? "Calculating..." : "Calculate & Save"}
        </button>
      </div>

      {error ? (
        <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div>
          <div className="mb-2 text-sm font-bold">Allocation result</div>
          <div className="desk-grid-wrap">
            <table className="desk-grid">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Share of duty</th>
                  <th>Duty / unit</th>
                  <th>Saved customs / unit</th>
                  <th>Landed cost</th>
                </tr>
              </thead>
              <tbody>
                {result.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.name}</td>
                    <td className="report-amount">{row.quantity}</td>
                    <td className="report-amount">{formatAmount(row.share)}</td>
                    <td className="report-amount">
                      {formatAmount(row.perUnit)}
                    </td>
                    <td className="report-amount">
                      {formatAmount(row.customsDuty)}
                    </td>
                    <td className="report-amount">
                      {formatAmount(row.landedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
