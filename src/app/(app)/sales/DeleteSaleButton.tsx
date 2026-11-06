"use client";

import { useRouter } from "next/navigation";
import { isConnectionFailure } from "@/lib/connection-failure";

export function DeleteSaleButton({
  id,
  receiptNumber,
  onDeleted,
  onFailed,
}: {
  id: string;
  receiptNumber: string;
  onDeleted?: () => void;
  onFailed?: () => void;
}) {
  const router = useRouter();

  async function onDelete() {
    const ok = confirm(
      `OWNER ONLY\n\nDelete sale ${receiptNumber}?\n\nThis permanently removes the transaction and restores stock.\nCashiers cannot delete completed sales.\n\nContinue?`
    );
    if (!ok) return;

    onDeleted?.();
    const res = await fetch(`/api/sales?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok || isConnectionFailure(res.status)) {
      router.refresh();
      return;
    }
    onFailed?.();
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      className="text-xs font-semibold text-red-600 hover:underline"
      title="Owner only — restores stock"
    >
      Delete (Owner)
    </button>
  );
}
