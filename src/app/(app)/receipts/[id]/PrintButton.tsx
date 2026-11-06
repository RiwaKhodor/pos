"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export function PrintButton({
  saleId,
  autoPrint = false,
}: {
  saleId: string;
  autoPrint?: boolean;
}) {
  const searchParams = useSearchParams();
  const shouldAuto = autoPrint || searchParams.get("print") === "1";
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function printNow() {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`/api/receipts/${saleId}/print`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Print failed");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Print failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!shouldAuto) return;
    const timer = setTimeout(() => {
      printNow();
    }, 400);
    return () => clearTimeout(timer);
    // One auto-print after the receipt opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAuto, saleId]);

  return (
    <span className="inline-flex items-center gap-2 print:hidden">
      {status ? (
        <span className="text-sm text-slate-600">{status}</span>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => printNow()}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-60"
      >
        {busy ? "Printing..." : "Print"}
      </button>
    </span>
  );
}
