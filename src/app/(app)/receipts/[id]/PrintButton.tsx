"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  const searchParams = useSearchParams();
  const shouldAuto =
    autoPrint || searchParams.get("print") === "1";

  useEffect(() => {
    if (!shouldAuto) return;
    const timer = setTimeout(() => {
      window.print();
    }, 400);
    return () => clearTimeout(timer);
  }, [shouldAuto]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white print:hidden"
    >
      Print
    </button>
  );
}
