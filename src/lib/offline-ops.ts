import { prisma } from "@/lib/prisma";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { localDb } from "@/lib/local-db";
import { dropLocalSale } from "@/lib/offline-sale";
import { lotDb, restoreSaleItemStock, syncProductLots } from "@/lib/stock-lots";
import {
  forgetCatalogProduct,
  forgetLocalCategory,
  forgetLocalContainer,
  forgetLocalExpense,
  mirrorProductRecord,
  readProduct,
  rememberUser,
  setLocalStock,
  upsertLocalCategory,
  upsertLocalContainer,
  upsertLocalEmployee,
  upsertLocalExpense,
  upsertLocalPaymentMethod,
  writeCachedSettings,
  type CachedSettings,
} from "@/lib/catalog-cache";

type PendingRow = {
  key: string;
  kind: string;
  payload_json: string;
  attempts: number;
};

type Pending = {
  key: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function rows(): Pending[] {
  const stored = localDb()
    .prepare(
      "SELECT key, kind, payload_json, attempts FROM pending_ops ORDER BY created_at ASC"
    )
    .all() as PendingRow[];
  return stored.map((row) => ({
    key: row.key,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    attempts: row.attempts,
  }));
}

export function queueOp(key: string, kind: string, payload: unknown) {
  localDb()
    .prepare(
      `INSERT INTO pending_ops (key, kind, payload_json, created_at, attempts)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET
         kind = excluded.kind,
         payload_json = excluded.payload_json,
         created_at = excluded.created_at,
         attempts = 0`
    )
    .run(key, kind, JSON.stringify(payload), new Date().toISOString());
}

export function dropOp(key: string) {
  localDb().prepare("DELETE FROM pending_ops WHERE key = ?").run(key);
}

export function queueDelete(key: string, kind: string, payload: unknown) {
  const existing = localDb()
    .prepare("SELECT payload_json FROM pending_ops WHERE key = ?")
    .get(key) as { payload_json: string } | undefined;
  if (existing) {
    const body = JSON.parse(existing.payload_json) as { pendingCreate?: boolean };
    if (body.pendingCreate) {
      dropOp(key);
      return;
    }
  }
  queueOp(key, kind, payload);
}

function text(value: unknown) {
  return value == null ? null : String(value);
}

function applyLocal(op: Pending) {
  const body = op.payload;
  if (op.kind === "settings") {
    writeCachedSettings(body as CachedSettings);
    return;
  }
  if (op.kind === "employee.upsert") {
    if (body.passwordHash) {
      rememberUser({
        id: String(body.id),
        name: String(body.name),
        email: String(body.email),
        passwordHash: String(body.passwordHash),
        role: String(body.role || "EMPLOYEE"),
        active: Boolean(body.active),
      });
    }
    upsertLocalEmployee({
      id: String(body.id),
      name: String(body.name),
      email: String(body.email),
      active: Boolean(body.active),
      createdAt: String(body.createdAt || new Date().toISOString()),
    });
    return;
  }
  if (op.kind === "expense.upsert") {
    upsertLocalExpense({
      id: String(body.id),
      note: String(body.note || ""),
      amount: Number(body.amount || 0),
      date: String(body.date || new Date().toISOString()),
    });
    return;
  }
  if (op.kind === "expense.delete") {
    forgetLocalExpense(String(body.id));
    return;
  }
  if (op.kind === "category.upsert") {
    upsertLocalCategory({
      id: String(body.id),
      name: String(body.name || ""),
      createdAt: text(body.createdAt) || undefined,
    });
    return;
  }
  if (op.kind === "category.delete") {
    forgetLocalCategory(String(body.id));
    return;
  }
  if (op.kind === "payment.upsert") {
    upsertLocalPaymentMethod({
      id: String(body.id),
      name: String(body.name || ""),
      active: body.active !== false,
      createdAt: text(body.createdAt) || undefined,
    });
    return;
  }
  if (op.kind === "container.upsert") {
    upsertLocalContainer({
      id: String(body.id),
      code: String(body.code || ""),
      name: String(body.name || ""),
      note: text(body.note),
      arrivedAt: text(body.arrivedAt),
      cost: Number(body.cost || 0),
      totalDuty: Number(body.totalDuty || 0),
    });
    return;
  }
  if (op.kind === "container.delete") {
    forgetLocalContainer(String(body.id));
    return;
  }
  if (op.kind === "product.upsert") {
    const existing = readProduct(String(body.id));
    const lots = Array.isArray(body.lots) ? body.lots : existing?.lots || [];
    mirrorProductRecord({
      id: String(body.id),
      name: String(body.name || existing?.name || ""),
      sku: text(body.sku),
      barcode: text(body.barcode),
      unit: String(body.unit || existing?.unit || "Pcs"),
      price: Number(body.price ?? existing?.price ?? 0),
      wholesalePrice: Number(body.wholesalePrice ?? existing?.wholesalePrice ?? 0),
      onlinePrice: Number(body.onlinePrice ?? existing?.onlinePrice ?? 0),
      retailPrice: Number(body.retailPrice ?? existing?.retailPrice ?? 0),
      maxDiscountPercent:
        body.maxDiscountPercent !== undefined
          ? body.maxDiscountPercent == null || body.maxDiscountPercent === ""
            ? null
            : Math.min(100, Math.max(0, Number(body.maxDiscountPercent)))
          : existing?.maxDiscountPercent ?? null,
      wholesaleMinQty: Number(body.wholesaleMinQty ?? existing?.wholesaleMinQty ?? 0),
      wholesaleMaxQty: Number(body.wholesaleMaxQty ?? existing?.wholesaleMaxQty ?? 0),
      stock: Number(body.stock ?? existing?.stock ?? 0),
      trackQty: body.trackQty !== false,
      active: body.active !== false,
      showInPos: body.showInPos !== false,
      cost: Number(body.cost ?? existing?.cost ?? 0),
      customsDuty: Number(body.customsDuty ?? existing?.customsDuty ?? 0),
      containerId: text(body.containerId),
      lowStockAt: Number(body.lowStockAt ?? 0),
      maxStock: Number(body.maxStock ?? 0),
      description: text(body.description),
      categoryId: text(body.categoryId),
      createdById: text(body.createdById),
      stockLots: lots.map((lot) => {
        const row = lot as Record<string, unknown>;
        return {
          id: String(row.id || crypto.randomUUID()),
          containerId: text(row.containerId),
          quantity: Number(row.quantity || 0),
          cost: Number(row.cost || 0),
          customsDuty: Number(row.customsDuty || 0),
          receivedAt: String(row.receivedAt || new Date().toISOString()),
        };
      }),
    });
    return;
  }
  if (op.kind === "product.delete") {
    forgetCatalogProduct(String(body.id));
    return;
  }
  if (op.kind === "stock.set") {
    setLocalStock(String(body.id), Number(body.stock || 0));
    return;
  }
  if (op.kind === "sale.delete") {
    dropLocalSale(String(body.id));
    return;
  }
  if (op.kind === "push.unsubscribe") {
    localDb()
      .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
      .run(String(body.endpoint || ""));
    return;
  }
  if (op.kind === "push.subscribe") {
    localDb()
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           updated_at = excluded.updated_at`
      )
      .run(
        String(body.endpoint || ""),
        String(body.userId || ""),
        String(body.p256dh || ""),
        String(body.auth || ""),
        body.userAgent ? String(body.userAgent) : null,
        new Date().toISOString()
      );
  }
}

export function reapplyPendingOps() {
  for (const op of rows()) {
    if (op.attempts >= 8) continue;
    try {
      applyLocal(op);
    } catch (error) {
      console.error(error);
    }
  }
}

async function replay(op: Pending) {
  const body = op.payload;
  if (op.kind === "settings") {
    const settings = body as CachedSettings;
    await prisma.storeSettings.upsert({
      where: { id: "default" },
      update: settings,
      create: { id: "default", ...settings },
    });
    return;
  }
  if (op.kind === "employee.upsert") {
    const data: {
      name: string;
      email: string;
      role: string;
      active: boolean;
      passwordHash?: string;
    } = {
      name: String(body.name),
      email: String(body.email).toLowerCase(),
      role: String(body.role || "EMPLOYEE"),
      active: Boolean(body.active),
    };
    if (body.passwordHash) data.passwordHash = String(body.passwordHash);
    await prisma.user.upsert({
      where: { id: String(body.id) },
      update: data,
      create: {
        id: String(body.id),
        ...data,
        passwordHash: String(body.passwordHash || ""),
      },
    });
    return;
  }
  if (op.kind === "expense.upsert") {
    const data = {
      amount: Number(body.amount || 0),
      note: String(body.note || ""),
      date: new Date(String(body.date)),
    };
    await prisma.expense.upsert({
      where: { id: String(body.id) },
      update: data,
      create: { id: String(body.id), ...data },
    });
    return;
  }
  if (op.kind === "expense.delete") {
    await prisma.expense.delete({ where: { id: String(body.id) } }).catch((error) => {
      if ((error as { code?: string }).code !== "P2025") throw error;
    });
    return;
  }
  if (op.kind === "category.upsert") {
    const name = String(body.name || "");
    await prisma.category.upsert({
      where: { id: String(body.id) },
      update: { name },
      create: { id: String(body.id), name },
    });
    return;
  }
  if (op.kind === "category.delete") {
    await prisma.category.delete({ where: { id: String(body.id) } }).catch((error) => {
      if ((error as { code?: string }).code !== "P2025") throw error;
    });
    return;
  }
  if (op.kind === "payment.upsert") {
    const data = {
      name: String(body.name || ""),
      active: body.active !== false,
    };
    await prisma.paymentMethod.upsert({
      where: { id: String(body.id) },
      update: data,
      create: { id: String(body.id), ...data },
    });
    return;
  }
  if (op.kind === "container.upsert") {
    const data = {
      code: String(body.code || ""),
      name: String(body.name || ""),
      note: text(body.note),
      cost: Number(body.cost || 0),
      totalDuty: Number(body.totalDuty || 0),
      arrivedAt: body.arrivedAt ? new Date(String(body.arrivedAt)) : null,
    };
    await prisma.container.upsert({
      where: { id: String(body.id) },
      update: data,
      create: { id: String(body.id), ...data },
    });
    return;
  }
  if (op.kind === "container.delete") {
    await prisma.container.delete({ where: { id: String(body.id) } }).catch((error) => {
      if ((error as { code?: string }).code !== "P2025") throw error;
    });
    return;
  }
  if (op.kind === "product.upsert") {
    const data = {
      name: String(body.name || ""),
      sku: text(body.sku),
      barcode: text(body.barcode),
      unit: String(body.unit || "Pcs"),
      price: Number(body.price || 0),
      cost: Number(body.cost || 0),
      customsDuty: Number(body.customsDuty || 0),
      wholesalePrice: Number(body.wholesalePrice || 0),
      onlinePrice: Number(body.onlinePrice || 0),
      retailPrice: Number(body.retailPrice || 0),
      maxDiscountPercent:
        body.maxDiscountPercent == null || body.maxDiscountPercent === ""
          ? null
          : Math.min(100, Math.max(0, Number(body.maxDiscountPercent))),
      wholesaleMinQty: Math.max(0, Math.floor(Number(body.wholesaleMinQty || 0))),
      wholesaleMaxQty: Math.max(0, Math.floor(Number(body.wholesaleMaxQty || 0))),
      stock: Math.max(0, Math.floor(Number(body.stock || 0))),
      lowStockAt: Math.max(0, Math.floor(Number(body.lowStockAt || 0))),
      maxStock: Math.max(0, Math.floor(Number(body.maxStock || 0))),
      description: text(body.description),
      categoryId: text(body.categoryId),
      containerId: text(body.containerId),
      active: body.active !== false,
      showInPos: body.showInPos !== false,
      trackQty: body.trackQty !== false,
      createdById: text(body.createdById),
    };
    await prisma.product.upsert({
      where: { id: String(body.id) },
      update: data,
      create: { id: String(body.id), ...data },
    });
    if (Array.isArray(body.lots)) {
      await syncProductLots(
        lotDb(),
        String(body.id),
        body.lots.map((lot) => {
          const row = lot as Record<string, unknown>;
          return {
            id: row.id ? String(row.id) : null,
            containerId: text(row.containerId),
            quantity: Number(row.quantity || 0),
            cost: Number(row.cost || 0),
            customsDuty: Number(row.customsDuty || 0),
          };
        })
      );
    }
    return;
  }
  if (op.kind === "product.delete") {
    await prisma.product.delete({ where: { id: String(body.id) } }).catch((error) => {
      if ((error as { code?: string }).code !== "P2025") throw error;
    });
    return;
  }
  if (op.kind === "stock.set") {
    const product = await prisma.product.findUnique({ where: { id: String(body.id) } });
    if (!product) return;
    const { setStockQuantity } = await import("@/lib/stock-lots");
    await setStockQuantity(lotDb(), product, Number(body.stock || 0));
    return;
  }
  if (op.kind === "sale.delete") {
    const sale = await prisma.sale.findUnique({
      where: { id: String(body.id) },
      include: { items: { include: { allocations: true } } },
    });
    if (!sale) return;
    for (const item of sale.items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });
      if (product?.trackQty) {
        await restoreSaleItemStock(lotDb(), item, sale.createdAt);
      }
    }
    await prisma.sale.delete({ where: { id: sale.id } });
    return;
  }
  if (op.kind === "push.unsubscribe") {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: String(body.endpoint || "") },
    });
    return;
  }
  if (op.kind === "push.subscribe") {
    const endpoint = String(body.endpoint || "");
    if (!endpoint) return;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: String(body.userId || ""),
        p256dh: String(body.p256dh || ""),
        auth: String(body.auth || ""),
        userAgent: body.userAgent ? String(body.userAgent) : null,
      },
      create: {
        userId: String(body.userId || ""),
        endpoint,
        p256dh: String(body.p256dh || ""),
        auth: String(body.auth || ""),
        userAgent: body.userAgent ? String(body.userAgent) : null,
      },
    });
  }
}

export function holdProduct(
  body: Record<string, unknown>,
  id: string,
  createdById: string | null
) {
  const existing = readProduct(id);
  const append = body.appendLot as { quantity?: number; cost?: number; customsDuty?: number; containerId?: string } | undefined;
  const stock = append
    ? (existing?.stock || 0) + Number(append.quantity || 0)
    : Number(body.stock ?? existing?.stock ?? 0);
  const lots = Array.isArray(body.lots)
    ? body.lots
    : append
      ? [
          ...(existing?.lots || []),
          {
            id: crypto.randomUUID(),
            containerId: append.containerId || null,
            quantity: Number(append.quantity || 0),
            cost: Number(append.cost || 0),
            customsDuty: Number(append.customsDuty || 0),
            receivedAt: new Date().toISOString(),
          },
        ]
      : existing?.lots || [];
  const payload = {
    id,
    name: body.name !== undefined ? String(body.name) : existing?.name || "",
    sku: body.sku !== undefined ? body.sku || null : existing?.sku || null,
    barcode: body.barcode !== undefined ? body.barcode || null : existing?.barcode || null,
    unit: body.unit !== undefined ? String(body.unit || "Pcs") : existing?.unit || "Pcs",
    price: Number(body.price ?? existing?.price ?? 0),
    cost: Number(body.cost ?? existing?.cost ?? 0),
    customsDuty: Number(body.customsDuty ?? existing?.customsDuty ?? 0),
    wholesalePrice: Number(body.wholesalePrice ?? existing?.wholesalePrice ?? 0),
    onlinePrice: Number(body.onlinePrice ?? existing?.onlinePrice ?? 0),
    retailPrice: Number(body.retailPrice ?? existing?.retailPrice ?? 0),
    maxDiscountPercent:
      body.maxDiscountPercent !== undefined
        ? body.maxDiscountPercent == null || body.maxDiscountPercent === ""
          ? null
          : Math.min(100, Math.max(0, Number(body.maxDiscountPercent)))
        : existing?.maxDiscountPercent ?? null,
    wholesaleMinQty: Number(body.wholesaleMinQty ?? existing?.wholesaleMinQty ?? 0),
    wholesaleMaxQty: Number(body.wholesaleMaxQty ?? existing?.wholesaleMaxQty ?? 0),
    stock,
    lowStockAt: Number(body.lowStockAt ?? 0),
    maxStock: Number(body.maxStock ?? 0),
    description: body.description !== undefined ? body.description || null : null,
    categoryId: body.categoryId !== undefined ? body.categoryId || null : null,
    containerId: body.containerId !== undefined ? body.containerId || null : existing?.containerId || null,
    active: body.active !== false,
    showInPos: body.showInPos !== false,
    trackQty: body.trackQty !== false,
    createdById,
    lots,
    pendingCreate: !existing,
  };
  queueOp(`product:${id}`, "product.upsert", payload);
  reapplyPendingOps();
  return payload;
}

export async function flushPendingOps() {
  for (const op of rows()) {
    if (op.attempts >= 8) continue;
    try {
      await replay(op);
      dropOp(op.key);
    } catch (error) {
      console.error(error);
      localDb()
        .prepare("UPDATE pending_ops SET attempts = attempts + 1 WHERE key = ?")
        .run(op.key);
      if (isDbUnavailable(error)) return;
    }
  }
}
