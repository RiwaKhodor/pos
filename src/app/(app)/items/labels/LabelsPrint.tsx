"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Barcode } from "@/components/Barcode";
import { formatUsd } from "@/lib/fx";

export type LabelItem = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  barcode: string | null;
};

export function LabelsPrint({ items }: { items: LabelItem[] }) {
  const router = useRouter();
  const lookRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [look, setLook] = useState("");
  const [copies, setCopies] = useState("1");
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState(
    "Scan a barcode, or type a name or item code, then press Enter. Scan again to add another."
  );

  useEffect(() => {
    lookRef.current?.focus();
  }, []);

  const term = look.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!term) return items;
    return items.filter((item) =>
      [item.name, item.sku || "", item.barcode || ""]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [items, term]);

  const chosen = items.filter((item) => item.barcode && selected[item.id]);
  const copyCount = useMemo(() => {
    if (!copies.trim()) return 0;
    const count = Math.floor(Number(copies));
    if (!Number.isFinite(count) || count < 1) return 0;
    return Math.min(50, count);
  }, [copies]);
  const labels = useMemo(() => {
    const out: LabelItem[] = [];
    for (const item of chosen) {
      for (let i = 0; i < copyCount; i++) out.push(item);
    }
    return out;
  }, [chosen, copyCount]);

  function pick(raw: string) {
    const text = raw.trim();
    if (!text) {
      setLook("");
      setMessage("Scan a barcode, or type a name or item code.");
      return;
    }
    const q = text.toLowerCase();
    const exact = items.find(
      (item) =>
        (item.barcode && item.barcode.toLowerCase() === q) ||
        (item.sku && item.sku.toLowerCase() === q)
    );
    const byName = items.filter((item) => item.name.toLowerCase() === q);
    const match = exact || (byName.length === 1 ? byName[0] : null);

    if (byName.length > 1 && !exact) {
      setLook(text);
      setMessage("More than one item has this name. Tick the right one below.");
      return;
    }

    if (match) {
      if (!match.barcode) {
        setMessage(
          `${match.name} has no barcode yet. Press Create missing barcodes, then scan it again.`
        );
        setLook("");
        return;
      }
      setSelected((prev) => ({ ...prev, [match.id]: true }));
      setLook("");
      setMessage(`Added ${match.name}. Scan another, or type a name.`);
      lookRef.current?.focus();
      return;
    }

    const partial = items.filter((item) =>
      [item.name, item.sku || "", item.barcode || ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    setLook(text);
    setMessage(
      partial.length
        ? `${partial.length} item${partial.length === 1 ? "" : "s"} match. Tick the ones you want.`
        : `No item matches “${text}”.`
    );
  }

  function selectShown() {
    setSelected((prev) => ({
      ...prev,
      ...Object.fromEntries(
        visible.filter((item) => item.barcode).map((item) => [item.id, true])
      ),
    }));
  }

  async function createBarcodes() {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/items/barcodes", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error || "Could not create barcodes");
      return;
    }
    setMessage(
      data.assigned
        ? `Created ${data.assigned} barcode${data.assigned === 1 ? "" : "s"}.`
        : "Every item already has a barcode."
    );
    router.refresh();
  }

  async function printLabels() {
    setPrinting(true);
    setMessage("");
    const res = await fetch("/api/items/labels/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        labels: labels.map((item) => ({
          name: item.name,
          price: item.price,
          barcode: item.barcode,
        })),
      }),
    });
    const data = await res.json();
    setPrinting(false);
    if (!res.ok) {
      setMessage(data.error || "Could not print labels");
      return;
    }
    setMessage(
      `Sent ${data.count} label${data.count === 1 ? "" : "s"} to the label printer.`
    );
  }

  const missing = items.filter((item) => !item.barcode).length;

  return (
    <div className="desk-panel">
      <div className="no-print mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">Barcode labels</div>
          <p className="mt-1 max-w-xl text-xs text-slate-600">
            Scan each item, or search by name or code. The ones you pick are
            printed on the label printer.
          </p>
        </div>
        <button
          type="button"
          className="desk-btn"
          onClick={() => router.push("/items")}
        >
          Close
        </button>
      </div>

      <div className="no-print mb-3 flex flex-wrap items-end gap-2">
        <div className="desk-field" style={{ minWidth: 280, flex: 1 }}>
          <label htmlFor="label-look">Scan or search</label>
          <input
            id="label-look"
            ref={lookRef}
            value={look}
            onChange={(e) => setLook(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                pick((e.target as HTMLInputElement).value);
              }
            }}
            placeholder="Scan barcode, or type name or code"
            autoComplete="off"
          />
        </div>
        <button type="button" className="desk-btn" onClick={() => pick(look)}>
          Find
        </button>
        <button
          type="button"
          className="desk-btn"
          disabled={busy || missing === 0}
          onClick={createBarcodes}
        >
          {busy ? "Creating…" : "Create missing barcodes"}
        </button>
        <button type="button" className="desk-btn" onClick={selectShown}>
          Select shown
        </button>
        <button type="button" className="desk-btn" onClick={() => setSelected({})}>
          Clear
        </button>
        <label className="text-xs">
          Copies each
          <input
            className="ml-2 w-16 border border-[#7a7a7a] px-2 py-1"
            type="text"
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value.replace(/\D/g, "").slice(0, 2))}
          />
        </label>
        <button
          type="button"
          className="desk-btn"
          disabled={labels.length === 0 || printing}
          onClick={printLabels}
        >
          {printing ? "Printing…" : "Print labels"}
        </button>
      </div>

      <div className="no-print mb-2 border border-[#9bb4cc] bg-[#eef5ff] px-3 py-2 text-xs">
        {message} {chosen.length} item{chosen.length === 1 ? "" : "s"} selected,{" "}
        {labels.length} label{labels.length === 1 ? "" : "s"} ready.
      </div>

      {chosen.length > 0 ? (
        <div className="no-print mb-3 flex flex-wrap gap-2">
          {chosen.map((item) => (
            <button
              key={item.id}
              type="button"
              className="desk-btn"
              onClick={() =>
                setSelected((prev) => ({ ...prev, [item.id]: false }))
              }
            >
              {item.name} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="no-print mb-3 max-h-64 overflow-auto border border-[#aaa] bg-white">
        <table className="desk-grid">
          <thead>
            <tr>
              <th></th>
              <th>Item</th>
              <th>Code</th>
              <th>Price</th>
              <th>Barcode</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5}>No items match.</td>
              </tr>
            ) : (
              visible.map((item) => (
                <tr key={item.id} data-selected={Boolean(selected[item.id])}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[item.id])}
                      disabled={!item.barcode}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [item.id]: e.target.checked,
                        }))
                      }
                    />
                  </td>
                  <td>{item.name}</td>
                  <td>{item.sku || "—"}</td>
                  <td>{formatUsd(item.price)}</td>
                  <td>{item.barcode || "No barcode yet"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="label-sheet">
        {labels.map((item, index) => (
          <div className="label" key={`${item.id}-${index}`}>
            <div className="label-name">{item.name}</div>
            <div className="label-price">{formatUsd(item.price)}</div>
            {item.barcode ? <Barcode value={item.barcode} /> : null}
            <div className="label-code">{item.barcode}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
