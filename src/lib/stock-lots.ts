import { Prisma } from "@prisma/client";
import { customsFromContainer } from "./container-duty";
import { toNum } from "./money";
import { prisma } from "./prisma";

export type LotTx = Prisma.TransactionClient;

export function lotDb(): LotTx {
  return prisma as unknown as LotTx;
}

export function parseLotRows(value: unknown): LotRowInput[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((row) => {
    const lot = (row || {}) as Record<string, unknown>;
    return {
      id: lot.id ? String(lot.id) : null,
      containerId: lot.containerId ? String(lot.containerId) : null,
      quantity: Number(lot.quantity || 0),
      cost: Number(lot.cost || 0),
      customsDuty: Number(lot.customsDuty || 0),
    };
  });
}

export async function withContainerCustoms(lots: LotRowInput[]) {
  const ids = [
    ...new Set(
      lots
        .map((lot) => lot.containerId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (ids.length === 0) return lots;
  const containers = await prisma.container.findMany({
    where: { id: { in: ids } },
    select: { id: true, cost: true, totalDuty: true },
  });
  const rates = new Map(
    containers.map((container) => [
      container.id,
      { cost: toNum(container.cost), totalDuty: toNum(container.totalDuty) },
    ])
  );
  return lots.map((lot) => {
    if (!lot.containerId || !rates.has(lot.containerId)) return lot;
    return {
      ...lot,
      customsDuty: customsFromContainer(lot.cost, rates.get(lot.containerId)),
    };
  });
}

export type LotRowInput = {
  id?: string | null;
  containerId?: string | null;
  quantity: number;
  cost: number;
  customsDuty: number;
  receivedAt?: Date | null;
};

export type LotAllocation = {
  stockLotId: string | null;
  containerId: string | null;
  containerCode: string | null;
  quantity: number;
  cost: number;
  customsDuty: number;
  unitCost: number;
};

type ProductSnap = {
  id: string;
  stock: number;
  cost: unknown;
  customsDuty: unknown;
  containerId: string | null;
  createdAt?: Date;
};

function landed(cost: number, duty: number) {
  return Number((cost + duty).toFixed(4));
}

export function formatContainerStock(
  lots: { quantity: number; containerCode: string | null }[]
) {
  const parts = lots
    .filter((lot) => lot.quantity > 0)
    .map(
      (lot) => `${lot.containerCode || "No container"} (${lot.quantity})`
    );
  return parts.length ? parts.join(", ") : null;
}

export async function refreshProductFromLots(tx: LotTx, productId: string) {
  const lots = await tx.stockLot.findMany({
    where: { productId },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
  });
  const positive = lots.filter((lot) => lot.quantity > 0);
  const stock = positive.reduce((sum, lot) => sum + lot.quantity, 0);
  const next = positive[0] ?? lots[0];
  await tx.product.update({
    where: { id: productId },
    data: {
      stock,
      ...(next
        ? {
            cost: next.cost,
            customsDuty: next.customsDuty,
            containerId: positive.length > 0 ? next.containerId : null,
          }
        : { containerId: null }),
    },
  });
}

export async function ensureOpeningLot(tx: LotTx, product: ProductSnap) {
  const count = await tx.stockLot.count({ where: { productId: product.id } });
  if (count > 0) return;
  if (product.stock <= 0 && !product.containerId) return;
  await tx.stockLot.create({
    data: {
      productId: product.id,
      containerId: product.containerId,
      quantity: Math.max(0, Math.floor(product.stock)),
      cost: toNum(product.cost),
      customsDuty: toNum(product.customsDuty),
      receivedAt: product.createdAt ?? new Date(),
    },
  });
}

export async function consumeFifo(
  tx: LotTx,
  product: ProductSnap,
  quantity: number
): Promise<{ unitCost: number; allocations: LotAllocation[] }> {
  await ensureOpeningLot(tx, product);
  const lots = await tx.stockLot.findMany({
    where: { productId: product.id, quantity: { gt: 0 } },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    include: { container: { select: { code: true } } },
  });

  let need = quantity;
  let costSum = 0;
  const allocations: LotAllocation[] = [];

  for (const lot of lots) {
    if (need <= 0) break;
    const take = Math.min(lot.quantity, need);
    const cost = toNum(lot.cost);
    const duty = toNum(lot.customsDuty);
    const unit = landed(cost, duty);
    costSum += unit * take;
    allocations.push({
      stockLotId: lot.id,
      containerId: lot.containerId,
      containerCode: lot.container?.code ?? null,
      quantity: take,
      cost,
      customsDuty: duty,
      unitCost: unit,
    });
    await tx.stockLot.update({
      where: { id: lot.id },
      data: { quantity: { decrement: take } },
    });
    need -= take;
  }

  if (need > 0) {
    const cost = toNum(product.cost);
    const duty = toNum(product.customsDuty);
    const unit = landed(cost, duty);
    costSum += unit * need;
    allocations.push({
      stockLotId: null,
      containerId: product.containerId,
      containerCode: null,
      quantity: need,
      cost,
      customsDuty: duty,
      unitCost: unit,
    });
  }

  await refreshProductFromLots(tx, product.id);
  const unitCost =
    quantity > 0 ? Number((costSum / quantity).toFixed(4)) : 0;
  return { unitCost, allocations };
}

export async function setStockQuantity(
  tx: LotTx,
  product: ProductSnap,
  newStock: number
) {
  const target = Math.max(0, Math.floor(newStock));
  await ensureOpeningLot(tx, product);
  const lots = await tx.stockLot.findMany({
    where: { productId: product.id },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
  });
  const current = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const delta = target - current;
  if (delta > 0) {
    const oldest = lots[0];
    if (oldest) {
      await tx.stockLot.update({
        where: { id: oldest.id },
        data: { quantity: { increment: delta } },
      });
    } else {
      await tx.stockLot.create({
        data: {
          productId: product.id,
          containerId: product.containerId,
          quantity: delta,
          cost: toNum(product.cost),
          customsDuty: toNum(product.customsDuty),
        },
      });
    }
    await refreshProductFromLots(tx, product.id);
    return;
  }
  if (delta < 0) {
    await consumeFifo(tx, product, -delta);
    return;
  }
  await refreshProductFromLots(tx, product.id);
}

export async function syncProductLots(
  tx: LotTx,
  productId: string,
  rows: LotRowInput[]
) {
  const existing = await tx.stockLot.findMany({ where: { productId } });
  const keep = new Set<string>();

  for (const row of rows) {
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    const cost = Number.isFinite(row.cost) ? row.cost : 0;
    const customsDuty = Number.isFinite(row.customsDuty) ? row.customsDuty : 0;
    const containerId = row.containerId || null;
    const known = row.id ? existing.find((lot) => lot.id === row.id) : undefined;
    if (known) {
      keep.add(known.id);
      await tx.stockLot.update({
        where: { id: known.id },
        data: { containerId, quantity, cost, customsDuty },
      });
    } else if (quantity > 0 || containerId) {
      const created = await tx.stockLot.create({
        data: {
          productId,
          containerId,
          quantity,
          cost,
          customsDuty,
          receivedAt: row.receivedAt ?? new Date(),
        },
      });
      keep.add(created.id);
    }
  }

  const remove = existing.filter((lot) => !keep.has(lot.id)).map((lot) => lot.id);
  if (remove.length > 0) {
    await tx.stockLot.deleteMany({ where: { id: { in: remove } } });
  }
  await refreshProductFromLots(tx, productId);
}

export async function upsertContainerLot(
  tx: LotTx,
  opts: {
    productId: string;
    containerId: string;
    quantity: number;
    cost: number;
    customsDuty: number;
    receivedAt?: Date | null;
  }
) {
  const existing = await tx.stockLot.findMany({
    where: { productId: opts.productId, containerId: opts.containerId },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
  });
  const quantity = Math.max(0, Math.floor(opts.quantity));
  if (quantity <= 0) {
    if (existing.length === 0) return;
    await tx.stockLot.deleteMany({
      where: { id: { in: existing.map((lot) => lot.id) } },
    });
    await refreshProductFromLots(tx, opts.productId);
    return;
  } else if (existing.length === 1) {
    await tx.stockLot.update({
      where: { id: existing[0].id },
      data: {
        quantity,
        cost: opts.cost,
        customsDuty: opts.customsDuty,
      },
    });
  } else if (existing.length > 1) {
    const others = existing.slice(1).reduce((sum, lot) => sum + lot.quantity, 0);
    await tx.stockLot.update({
      where: { id: existing[0].id },
      data: {
        quantity: Math.max(0, quantity - others),
        cost: opts.cost,
        customsDuty: opts.customsDuty,
      },
    });
  } else {
    await tx.stockLot.create({
      data: {
        productId: opts.productId,
        containerId: opts.containerId,
        quantity,
        cost: opts.cost,
        customsDuty: opts.customsDuty,
        receivedAt: opts.receivedAt ?? new Date(),
      },
    });
  }
  await refreshProductFromLots(tx, opts.productId);
}

export async function restoreSaleItemStock(
  tx: LotTx,
  item: {
    productId: string;
    quantity: number;
    allocations: {
      stockLotId: string | null;
      containerId: string | null;
      quantity: number;
      cost: unknown;
      customsDuty: unknown;
    }[];
  },
  receivedAt: Date
) {
  if (item.allocations.length === 0) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
    });
    if (!product?.trackQty) return;
    await setStockQuantity(tx, product, product.stock + item.quantity);
    return;
  }

  for (const allocation of item.allocations) {
    if (allocation.stockLotId) {
      const lot = await tx.stockLot.findUnique({
        where: { id: allocation.stockLotId },
      });
      if (lot) {
        await tx.stockLot.update({
          where: { id: lot.id },
          data: { quantity: { increment: allocation.quantity } },
        });
        continue;
      }
    }
    await tx.stockLot.create({
      data: {
        productId: item.productId,
        containerId: allocation.containerId,
        quantity: allocation.quantity,
        cost: toNum(allocation.cost),
        customsDuty: toNum(allocation.customsDuty),
        receivedAt,
      },
    });
  }
  await refreshProductFromLots(tx, item.productId);
}
