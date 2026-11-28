export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startSyncLoop } = await import("@/lib/sync-sales");
  startSyncLoop();
  // Keep the local dm price book filled (runs at most once a day, slowly).
  const { syncDmPriceBook } = await import("@/lib/dm-price-book");
  const flag = globalThis as unknown as { vanoDmBookLoop?: boolean };
  if (!flag.vanoDmBookLoop) {
    flag.vanoDmBookLoop = true;
    setTimeout(() => void syncDmPriceBook(), 60 * 1000);
    setInterval(() => void syncDmPriceBook(), 60 * 60 * 1000);
  }
  // Share names this PC found with the other PCs, and retry barcodes that found nothing.
  const { uploadLocalLookups } = await import("@/lib/shared-lookups");
  const { retryPendingLookups } = await import("@/lib/lookup-retry");
  const retryFlag = globalThis as unknown as { vanoLookupLoop?: boolean };
  if (!retryFlag.vanoLookupLoop) {
    retryFlag.vanoLookupLoop = true;
    setTimeout(() => void uploadLocalLookups(), 20 * 1000);
    setInterval(() => void uploadLocalLookups(), 30 * 60 * 1000);
    setInterval(() => void retryPendingLookups(), 2 * 60 * 1000);
  }
}
