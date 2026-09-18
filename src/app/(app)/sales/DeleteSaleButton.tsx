"use client";

import { useRouter } from "next/navigation";

export function DeleteSaleButton({
  id,
  receiptNumber,
}: {
  id: string;
  receiptNumber: string;
}) {
  const router = useRouter();

  async function onDelete() {
    const ok = confirm(
      `OWNER ONLY\n\nDelete sale ${receiptNumber}?\n\nThis permanently removes the transaction and restores stock.\nCashiers cannot delete completed sales.\n\nContinue?`
    );
    if (!ok) return;

    const res = await fetch(`/api/sales?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
      return;
    }
    const data = await res.json();
    alert(data.error || "Failed to delete. Only the owner can delete sales.");
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
