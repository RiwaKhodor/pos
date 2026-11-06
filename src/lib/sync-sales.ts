import { prisma } from "@/lib/prisma";
import { consumeFifo } from "@/lib/stock-lots";
import { toNum } from "@/lib/money";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { catalogSyncedAt, refreshCatalogFromSupabase } from "@/lib/catalog-cache";
import { flushPendingOps, reapplyPendingOps } from "@/lib/offline-ops";
import { flushPushOutbox } from "@/lib/push";
import { getMeta, maybeBackupLocalDb, readSnapshot, setMeta, vanoDataDir } from "@/lib/local-db";
import {
  markSaleRetry,
  markSaleSynced,
  pendingSalePayloads,
  saleAttempts,
  saleCounts,
  type LocalSalePayload,
} from "@/lib/offline-sale";

type SyncMode = "online" | "offline" | "syncing";

const state = {
  mode: "offline" as SyncMode,
  lastError: null as string | null,
  pingAt: 0,
  pingOk: false,
};

let chain: Promise<void> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>) {
  const run = chain.then(job, job);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("OFFLINE")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function supabaseReachable() {
  if (Date.now() - state.pingAt < 8000) return state.pingOk;
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 4000);
    state.pingAt = Date.now();
    state.pingOk = true;
    return true;
  } catch {
    state.pingAt = Date.now();
    state.pingOk = false;
    return false;
  }
}

async function uploadSale(payload: LocalSalePayload) {
  const existing = await prisma.sale.findUnique({
    where: { id: payload.id },
    select: { id: true },
  });
  if (existing) return false;

  let conflict = false;
  await prisma.$transaction(
    async (tx) => {
      const lines = [];
      for (const line of payload.items) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
        });
        if (!product) {
          throw new Error(`Product is no longer on the server: ${line.name}`);
        }
        if (product.trackQty && product.stock < line.quantity) conflict = true;
        const consumed = product.trackQty
          ? await consumeFifo(tx, product, line.quantity)
          : { unitCost: line.unitCost, allocations: [] };
        lines.push({ line, consumed });
      }

      await tx.sale.create({
        data: {
          id: payload.id,
          receiptNumber: payload.receiptNumber,
          subtotal: payload.subtotal,
          discount: payload.discount,
          tax: payload.tax,
          total: payload.total,
          pricingMode: payload.pricingMode,
          payCurrency: payload.payCurrency,
          exchangeRate: payload.exchangeRate,
          amountTendered: payload.amountTendered,
          changeUsd: payload.changeUsd,
          changeLbp: payload.changeLbp,
          changeCurrency: payload.changeCurrency,
          cashierId: payload.cashierId,
          paymentMethodId: payload.paymentMethodId,
          createdAt: new Date(payload.createdAt),
          items: {
            create: lines.map(({ line, consumed }) => ({
              productId: line.productId,
              name: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              unitCost: consumed.unitCost,
              lineTotal: line.lineTotal,
              allocations: {
                create: consumed.allocations.map((allocation) => ({
                  stockLotId: allocation.stockLotId,
                  containerId: allocation.containerId,
                  containerCode: allocation.containerCode,
                  quantity: allocation.quantity,
                  cost: toNum(allocation.cost),
                  customsDuty: toNum(allocation.customsDuty),
                  unitCost: toNum(allocation.unitCost),
                })),
              },
            })),
          },
        },
      });
    },
    { timeout: 20000 }
  );
  return conflict;
}

export function syncPendingSales() {
  return enqueue(async () => {
    state.mode = "syncing";
    const online = await supabaseReachable();
    if (!online) {
      state.mode = "offline";
      state.lastError = "No connection to the online database";
      setMeta("last_sync_error", state.lastError);
      return { uploaded: 0, online: false as const };
    }

    let uploaded = 0;
    try {
      await flushPendingOps();
      await flushPushOutbox();
    } catch (error) {
      console.error(error);
    }
    for (const payload of pendingSalePayloads()) {
      try {
        const conflict = await uploadSale(payload);
        markSaleSynced(payload.id, conflict);
        uploaded += 1;
        state.lastError = null;
      } catch (error) {
        const offline = isDbUnavailable(error);
        const message = error instanceof Error ? error.message : "Sync failed";
        state.lastError = message;
        const nextAttempts = saleAttempts(payload.id) + 1;
        markSaleRetry(payload.id, message, !offline && nextAttempts >= 8);
        setMeta("last_sync_error", message);
        if (offline) {
          state.mode = "offline";
          state.pingOk = false;
          state.pingAt = Date.now();
          return { uploaded, online: false as const };
        }
      }
    }

    if (uploaded === 0 && saleCounts().pending === 0) {
      const at = catalogSyncedAt();
      const age = at ? Date.now() - new Date(at).getTime() : Number.POSITIVE_INFINITY;
      const needsMirror = readSnapshot("sales") == null;
      if (needsMirror || age > 2 * 60 * 1000) {
        try {
          await refreshCatalogFromSupabase();
        } catch (error) {
          if (!isDbUnavailable(error)) {
            state.lastError =
              error instanceof Error ? error.message : "Catalog refresh failed";
          }
        }
      }
    }

    state.mode = "online";
    setMeta("last_sync_at", new Date().toISOString());
    reapplyPendingOps();
    return { uploaded, online: true as const };
  });
}

export function syncSnapshot() {
  const counts = saleCounts();
  const catalogAt = catalogSyncedAt();
  const age = catalogAt ? Date.now() - new Date(catalogAt).getTime() : null;
  const mode: SyncMode =
    state.mode === "syncing"
      ? "syncing"
      : state.mode === "online" && counts.pending > 0
        ? "syncing"
        : state.mode;
  return {
    mode,
    pending: counts.pending,
    synced: counts.synced,
    failed: counts.failed,
    conflict: counts.conflict,
    catalogAt,
    catalogStale: age == null || age > 15 * 60 * 1000,
    lastError: state.lastError || getMeta("last_sync_error") || null,
    lastSyncAt: getMeta("last_sync_at"),
    dataDir: vanoDataDir(),
  };
}

export async function syncSnapshotLive() {
  if (state.mode !== "syncing") {
    const online = await supabaseReachable();
    state.mode = online ? "online" : "offline";
    if (online && saleCounts().pending > 0) {
      void syncPendingSales();
    }
  }
  return syncSnapshot();
}

export function startSyncLoop() {
  const flag = globalThis as unknown as { vanoSyncLoop?: boolean };
  if (flag.vanoSyncLoop) return;
  flag.vanoSyncLoop = true;
  try {
    maybeBackupLocalDb();
  } catch (error) {
    console.error("Local database backup failed", error);
  }
  const tick = () => {
    void syncPendingSales().catch((error) => {
      state.lastError = error instanceof Error ? error.message : "Sync failed";
      state.mode = "offline";
    });
  };
  setInterval(tick, 20000);
  tick();
}
