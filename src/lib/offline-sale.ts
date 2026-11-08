import { randomUUID } from "crypto";
import { wholesaleQtyError } from "@/lib/wholesale";
import {
  computeMixedTender,
  DEFAULT_USD_TO_LBP,
  tenderPayCurrency,
  type PayCurrency,
} from "@/lib/fx";
import { RECEIPT_PHONE } from "@/lib/store-info";
import { localDb, readSnapshot, registerId, writeSnapshot } from "@/lib/local-db";
import {
  readCachedSettings,
  readPaymentMethods,
  readProduct,
  saveProduct,
  type CachedLot,
  type CachedProduct,
} from "@/lib/catalog-cache";
import {
  discountForLines,
  percentsFromSettings,
  tierPercent,
  unitPriceFor,
  volumePercentForAmount,
  type PricingMode,
} from "@/lib/price-tiers";

export type LocalSaleItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  allocations: {
    stockLotId: string | null;
    containerId: string | null;
    containerCode: string | null;
    quantity: number;
    cost: number;
    customsDuty: number;
    unitCost: number;
  }[];
};

export type LocalSalePayload = {
  id: string;
  receiptNumber: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  pricingMode: PricingMode;
  payCurrency: PayCurrency;
  exchangeRate: number;
  amountTendered: number;
  tenderedUsd: number;
  tenderedLbp: number;
  changeUsd: number;
  changeLbp: number;
  changeCurrency: PayCurrency;
  cashierId: string;
  cashierName: string;
  paymentMethodId: string;
  paymentMethodName: string;
  createdAt: string;
  storeName: string;
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
  items: LocalSaleItem[];
};

function landed(cost: number, duty: number) {
  return Number((cost + duty).toFixed(4));
}

function takeFromLots(product: CachedProduct, quantity: number) {
  const lots = [...product.lots].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt)
  );
  let need = quantity;
  let costSum = 0;
  const allocations: LocalSaleItem["allocations"] = [];
  const nextLots: CachedLot[] = lots.map((lot) => ({ ...lot }));

  for (const lot of nextLots) {
    if (need <= 0) break;
    if (lot.quantity <= 0) continue;
    const take = Math.min(lot.quantity, need);
    const unit = landed(lot.cost, lot.customsDuty);
    costSum += unit * take;
    allocations.push({
      stockLotId: lot.id,
      containerId: lot.containerId,
      containerCode: lot.containerCode,
      quantity: take,
      cost: lot.cost,
      customsDuty: lot.customsDuty,
      unitCost: unit,
    });
    lot.quantity -= take;
    need -= take;
  }

  if (need > 0) {
    const unit = landed(product.cost, product.customsDuty);
    costSum += unit * need;
    allocations.push({
      stockLotId: null,
      containerId: product.containerId,
      containerCode: null,
      quantity: need,
      cost: product.cost,
      customsDuty: product.customsDuty,
      unitCost: unit,
    });
  }

  const unitCost = quantity > 0 ? Number((costSum / quantity).toFixed(4)) : 0;
  return { lots: nextLots, allocations, unitCost };
}

export function completeSaleLocally(input: {
  items: { productId: string; quantity: number }[];
  paymentMethodId: string;
  pricingMode: PricingMode;
  payCurrency: PayCurrency;
  changeCurrency: PayCurrency;
  amountTendered: number;
  tenderedUsd?: number;
  tenderedLbp?: number;
  givenChangeUsd?: number | null;
  givenChangeLbp?: number | null;
  discount: number;
  cashierId: string;
  cashierName: string;
  ownerDiscount: boolean;
}) {
  const settings = readCachedSettings();
  if (!settings || catalogEmpty()) {
    throw new Error("NO_CATALOG");
  }
  const method = readPaymentMethods().find(
    (item) => item.id === input.paymentMethodId
  );
  if (!method) throw new Error("BAD_METHOD");

  const taxRate = settings.taxRate;
  const exchangeRate = settings.usdToLbpRate || DEFAULT_USD_TO_LBP;
  const db = localDb();
  db.exec("BEGIN");
  try {
    const lineItems: LocalSaleItem[] = [];
    let subtotal = 0;
    const touched: CachedProduct[] = [];
    const caps = new Map<string, number | null>();

    for (const item of input.items) {
      const quantity = Number(item.quantity);
      if (!item.productId || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error("INVALID_ITEM");
      }
      const product = readProduct(item.productId);
      if (!product || !product.active || !product.showInPos) {
        throw new Error("PRODUCT_MISSING");
      }
      if (product.trackQty && product.stock < quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
      }
      const wholesale = product.wholesalePrice;
      if (input.pricingMode === "WHOLESALE" && wholesale > 0) {
        const qtyErr = wholesaleQtyError(quantity, {
          wholesalePrice: wholesale,
          wholesaleMinQty: product.wholesaleMinQty,
          wholesaleMaxQty: product.wholesaleMaxQty,
        });
        if (qtyErr) throw new Error(`WHOLESALE_QTY:${product.name}:${qtyErr}`);
      }
      const unitPrice = unitPriceFor(input.pricingMode, product);
      caps.set(product.id, product.maxDiscountPercent);
      const lineTotal = Number((unitPrice * quantity).toFixed(2));
      subtotal += lineTotal;
      const taken = takeFromLots(product, quantity);
      product.stock = Math.max(0, product.stock - quantity);
      product.lots = taken.lots;
      touched.push(product);
      lineItems.push({
        id: randomUUID(),
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice,
        unitCost: taken.unitCost,
        lineTotal,
        allocations: taken.allocations,
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    const percents = percentsFromSettings(settings);
    const tierPct =
      input.pricingMode === "WHOLESALE_PCT"
        ? volumePercentForAmount(subtotal, percents)
        : tierPercent(input.pricingMode, percents);
    let discount = 0;
    if (tierPct > 0) {
      discount = discountForLines(
        lineItems.map((line) => ({
          amount: line.lineTotal,
          maxDiscountPercent: caps.get(line.productId) ?? null,
        })),
        tierPct
      ).discount;
    } else if (input.ownerDiscount) {
      const raw = Number(input.discount);
      if (Number.isFinite(raw) && raw > 0) {
        discount = Number(Math.min(raw, subtotal).toFixed(2));
      }
    }
    const taxable = Number((subtotal - discount).toFixed(2));
    const tax = Number(((taxable * taxRate) / 100).toFixed(2));
    const total = Number((taxable + tax).toFixed(2));
    const splitGiven =
      input.tenderedUsd != null || input.tenderedLbp != null;
    let tenderedUsd = Number(input.tenderedUsd || 0);
    let tenderedLbp = Number(input.tenderedLbp || 0);
    if (!splitGiven) {
      if (!Number.isFinite(input.amountTendered) || input.amountTendered < 0) {
        throw new Error("INVALID_TENDER");
      }
      if (input.payCurrency === "LBP") {
        tenderedLbp = input.amountTendered;
        tenderedUsd = 0;
      } else {
        tenderedUsd = input.amountTendered;
        tenderedLbp = 0;
      }
    }
    if (
      !Number.isFinite(tenderedUsd) ||
      tenderedUsd < 0 ||
      !Number.isFinite(tenderedLbp) ||
      tenderedLbp < 0
    ) {
      throw new Error("INVALID_TENDER");
    }
    const mixed = computeMixedTender({
      totalUsd: total,
      rate: exchangeRate,
      tenderedUsd,
      tenderedLbp,
      changeUsd: input.givenChangeUsd,
      changeLbp: input.givenChangeLbp,
    });
    if (!mixed.enough) throw new Error("INSUFFICIENT_TENDER");
    const payCurrency = tenderPayCurrency(mixed.tenderedUsd, mixed.tenderedLbp);
    const changeCurrency = tenderPayCurrency(mixed.changeUsd, mixed.changeLbp);

    const short = registerId().replace(/-/g, "").slice(0, 4).toUpperCase();
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    const payload: LocalSalePayload = {
      id: randomUUID(),
      receiptNumber: `${short}-R-${stamp}-${rand}`,
      subtotal,
      discount,
      tax,
      total,
      pricingMode: input.pricingMode,
      payCurrency,
      exchangeRate: mixed.rate,
      amountTendered: mixed.paidUsd,
      tenderedUsd: mixed.tenderedUsd,
      tenderedLbp: mixed.tenderedLbp,
      changeUsd: mixed.changeUsd,
      changeLbp: mixed.changeLbp,
      changeCurrency,
      cashierId: input.cashierId,
      cashierName: input.cashierName,
      paymentMethodId: method.id,
      paymentMethodName: method.name,
      createdAt: new Date().toISOString(),
      storeName: settings.storeName,
      address: settings.address,
      phone: settings.phone || RECEIPT_PHONE,
      receiptFooter: settings.receiptFooter,
      items: lineItems,
    };

    db.prepare(
      `INSERT INTO local_sales (
        id, receipt_number, cashier_id, payload_json, sync_status, attempts,
        stock_conflict, created_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)`
    ).run(
      payload.id,
      payload.receiptNumber,
      payload.cashierId,
      JSON.stringify(payload),
      payload.createdAt
    );
    for (const product of touched) saveProduct(product);
    db.exec("COMMIT");
    return payload;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function catalogEmpty() {
  const row = localDb()
    .prepare("SELECT COUNT(*) AS n FROM catalog_products")
    .get() as { n: number };
  return row.n === 0;
}

export function readLocalSale(id: string) {
  const row = localDb()
    .prepare("SELECT payload_json, sync_status, stock_conflict FROM local_sales WHERE id = ?")
    .get(id) as
    | { payload_json: string; sync_status: string; stock_conflict: number }
    | undefined;
  if (!row) return null;
  return {
    ...(JSON.parse(row.payload_json) as LocalSalePayload),
    syncStatus: row.sync_status,
    stockConflict: row.stock_conflict === 1,
  };
}

export function listLocalSales(cashierId?: string) {
  const rows = (
    cashierId
      ? localDb()
          .prepare(
            "SELECT payload_json, sync_status FROM local_sales WHERE cashier_id = ? ORDER BY created_at DESC LIMIT 100"
          )
          .all(cashierId)
      : localDb()
          .prepare(
            "SELECT payload_json, sync_status FROM local_sales ORDER BY created_at DESC LIMIT 100"
          )
          .all()
  ) as { payload_json: string; sync_status: string }[];
  return rows.map((row) => ({
    ...(JSON.parse(row.payload_json) as LocalSalePayload),
    syncStatus: row.sync_status,
  }));
}

export function saleCounts() {
  const rows = localDb()
    .prepare(
      "SELECT sync_status AS status, COUNT(*) AS n FROM local_sales GROUP BY sync_status"
    )
    .all() as { status: string; n: number }[];
  const counts = { pending: 0, synced: 0, failed: 0, conflict: 0 };
  for (const row of rows) {
    if (row.status === "pending") counts.pending = row.n;
    else if (row.status === "synced") counts.synced = row.n;
    else if (row.status === "failed") counts.failed = row.n;
    else if (row.status === "conflict") counts.conflict = row.n;
  }
  return counts;
}

export function pendingSalePayloads() {
  const rows = localDb()
    .prepare(
      "SELECT payload_json FROM local_sales WHERE sync_status = 'pending' ORDER BY created_at ASC"
    )
    .all() as { payload_json: string }[];
  return rows.map((row) => JSON.parse(row.payload_json) as LocalSalePayload);
}

export function saleAttempts(id: string) {
  const row = localDb()
    .prepare("SELECT attempts FROM local_sales WHERE id = ?")
    .get(id) as { attempts: number } | undefined;
  return row?.attempts ?? 0;
}

export function markSaleSynced(id: string, conflict: boolean) {
  localDb()
    .prepare(
      `UPDATE local_sales
       SET sync_status = ?, sync_error = NULL, stock_conflict = ?, synced_at = ?
       WHERE id = ?`
    )
    .run(conflict ? "conflict" : "synced", conflict ? 1 : 0, new Date().toISOString(), id);
}

export function markSaleRetry(id: string, error: string, failed: boolean) {
  localDb()
    .prepare(
      `UPDATE local_sales
       SET attempts = attempts + 1, sync_error = ?, sync_status = ?
       WHERE id = ?`
    )
    .run(error.slice(0, 500), failed ? "failed" : "pending", id);
}

export type ShopSaleRow = {
  id: string;
  receiptNumber: string;
  total: number;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  customerName: string;
  paymentName: string;
  itemCount: number;
  cogs: number;
  pending: boolean;
  items: {
    productId: string;
    name: string;
    quantity: number;
    lineTotal: number;
    unitCost: number;
  }[];
};

export function listShopSales(cashierId?: string) {
  const mirrored =
    readSnapshot<Omit<ShopSaleRow, "pending">[]>("sales") || [];
  const byId = new Map<string, ShopSaleRow>();
  for (const sale of mirrored) {
    if (cashierId && sale.cashierId !== cashierId) continue;
    byId.set(sale.id, { ...sale, pending: false });
  }
  for (const sale of listLocalSales(cashierId)) {
    byId.set(sale.id, {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      total: sale.total,
      createdAt: sale.createdAt,
      cashierId: sale.cashierId,
      cashierName: sale.cashierName,
      customerName: "Walk-in",
      paymentName: sale.paymentMethodName,
      itemCount: sale.items.length,
      cogs: sale.items.reduce(
        (sum, item) => sum + item.unitCost * item.quantity,
        0
      ),
      pending: sale.syncStatus !== "synced",
      items: sale.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        unitCost: item.unitCost,
      })),
    });
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function restoreLocalSaleStock(
  items: {
    productId: string;
    quantity: number;
    allocations?: {
      stockLotId: string | null;
      containerId: string | null;
      containerCode: string | null;
      quantity: number;
      cost: number;
      customsDuty: number;
    }[];
  }[]
) {
  for (const item of items) {
    const product = readProduct(item.productId);
    if (!product || !product.trackQty) continue;
    let restored = 0;
    for (const alloc of item.allocations || []) {
      if (!alloc.stockLotId) continue;
      const lot = product.lots.find((row) => row.id === alloc.stockLotId);
      if (!lot) continue;
      lot.quantity += alloc.quantity;
      restored += alloc.quantity;
    }
    const leftover = item.quantity - restored;
    if (leftover > 0) {
      const lot = product.lots[0];
      if (lot) lot.quantity += leftover;
      else {
        product.lots.push({
          id: randomUUID(),
          containerId: product.containerId,
          containerCode: null,
          quantity: leftover,
          cost: product.cost,
          customsDuty: product.customsDuty,
          receivedAt: new Date().toISOString(),
        });
      }
    }
    product.stock = product.lots.reduce(
      (sum, lot) => sum + Math.max(0, lot.quantity),
      0
    );
    saveProduct(product);
  }
}

export function dropLocalSale(id: string) {
  localDb().prepare("DELETE FROM local_sales WHERE id = ?").run(id);
  const sales = readSnapshot<{ id: string }[]>("sales");
  if (!sales) return;
  writeSnapshot(
    "sales",
    sales.filter((sale) => sale.id !== id)
  );
}
