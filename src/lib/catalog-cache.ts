import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { getMeta, localDb, readSnapshot, setMeta, writeSnapshot } from "@/lib/local-db";

export type CachedLot = {
  id: string;
  containerId: string | null;
  containerCode: string | null;
  quantity: number;
  cost: number;
  customsDuty: number;
  receivedAt: string;
};

export type CachedProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  wholesalePrice: number;
  onlinePrice: number;
  retailPrice: number;
  maxDiscountPercent: number | null;
  wholesaleMinQty: number;
  wholesaleMaxQty: number;
  stock: number;
  trackQty: boolean;
  active: boolean;
  showInPos: boolean;
  cost: number;
  customsDuty: number;
  containerId: string | null;
  lots: CachedLot[];
};

export type CachedSettings = {
  storeName: string;
  currency: string;
  usdToLbpRate: number;
  taxRate: number;
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
  discAbove500: number;
  discAbove1000: number;
  discAbove3000: number;
  discAbove5000: number;
  discAbove7000: number;
  discAbove10000: number;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  wholesale_price: number;
  online_price?: number;
  retail_price?: number;
  wholesale_min_qty: number;
  wholesale_max_qty: number;
  stock: number;
  track_qty: number;
  active: number;
  show_in_pos: number;
  cost: number;
  customs_duty: number;
  container_id: string | null;
  lots_json: string;
  category_name?: string | null;
  low_stock_at?: number | null;
  created_by_id?: string | null;
  category_id?: string | null;
  description?: string | null;
  max_stock?: number | null;
  max_discount_percent?: number | null;
};

function rowToProduct(row: ProductRow): CachedProduct {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    unit: row.unit,
    price: row.price,
    wholesalePrice: row.wholesale_price,
    onlinePrice: row.online_price ?? 0,
    retailPrice: row.retail_price ?? 0,
    maxDiscountPercent:
      row.max_discount_percent == null ? null : row.max_discount_percent,
    wholesaleMinQty: row.wholesale_min_qty,
    wholesaleMaxQty: row.wholesale_max_qty,
    stock: row.stock,
    trackQty: row.track_qty === 1,
    active: row.active === 1,
    showInPos: row.show_in_pos === 1,
    cost: row.cost,
    customsDuty: row.customs_duty,
    containerId: row.container_id,
    lots: JSON.parse(row.lots_json) as CachedLot[],
  };
}

export function catalogSyncedAt() {
  return getMeta("catalog_synced_at");
}

export function catalogCount() {
  const row = localDb()
    .prepare("SELECT COUNT(*) AS n FROM catalog_products")
    .get() as { n: number };
  return row.n;
}

export function readCachedSettings(): CachedSettings | null {
  const row = localDb()
    .prepare("SELECT json FROM settings_cache WHERE id = 'default'")
    .get() as { json: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.json) as Partial<CachedSettings>;
  return {
    storeName: parsed.storeName || "VANO",
    currency: parsed.currency || "USD",
    usdToLbpRate: parsed.usdToLbpRate || 89500,
    taxRate: parsed.taxRate || 0,
    address: parsed.address ?? null,
    phone: parsed.phone ?? null,
    receiptFooter: parsed.receiptFooter ?? null,
    discAbove500: parsed.discAbove500 || 0,
    discAbove1000: parsed.discAbove1000 || 0,
    discAbove3000: parsed.discAbove3000 || 0,
    discAbove5000: parsed.discAbove5000 || 0,
    discAbove7000: parsed.discAbove7000 || 0,
    discAbove10000: parsed.discAbove10000 || 0,
  };
}

export function writeCachedSettings(settings: CachedSettings) {
  localDb()
    .prepare(
      "INSERT INTO settings_cache (id, json) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json"
    )
    .run(JSON.stringify(settings));
}

function saveLocal(work: () => void) {
  try {
    work();
  } catch (error) {
    console.error(error);
  }
}

function patchSnapshot<T extends { id: string }>(
  key: string,
  next: T | null,
  place: "start" | "end" = "start"
) {
  saveLocal(() => {
    const current = readSnapshot<T[]>(key) || [];
    const rest = next ? current.filter((row) => row.id !== next.id) : current;
    if (!next) {
      writeSnapshot(key, rest);
      return;
    }
    writeSnapshot(key, place === "start" ? [next, ...rest] : [...rest, next]);
  });
}

export function upsertLocalEmployee(employee: {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: Date | string;
}) {
  patchSnapshot("employees", {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    active: employee.active,
    createdAt:
      employee.createdAt instanceof Date
        ? employee.createdAt.toISOString()
        : new Date(employee.createdAt).toISOString(),
  });
}

export function forgetLocalEmployee(id: string) {
  const current = readSnapshot<{ id: string }[]>("employees");
  if (!current) return;
  writeSnapshot(
    "employees",
    current.filter((row) => row.id !== id)
  );
}

export function upsertLocalPaymentMethod(method: {
  id: string;
  name: string;
  active: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}) {
  localDb()
    .prepare(
      `INSERT INTO payment_methods (id, name, active) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active`
    )
    .run(method.id, method.name, method.active ? 1 : 0);
  const now = new Date().toISOString();
  const created =
    method.createdAt instanceof Date
      ? method.createdAt.toISOString()
      : method.createdAt || now;
  const updated =
    method.updatedAt instanceof Date
      ? method.updatedAt.toISOString()
      : method.updatedAt || now;
  const current = readSnapshot<
    {
      id: string;
      name: string;
      active: boolean;
      createdAt: string;
      updatedAt: string;
    }[]
  >("payment-methods") || [];
  const rest = current.filter((row) => row.id !== method.id);
  rest.push({
    id: method.id,
    name: method.name,
    active: method.active,
    createdAt: created,
    updatedAt: updated,
  });
  rest.sort((a, b) => a.name.localeCompare(b.name));
  writeSnapshot("payment-methods", rest);
}

export function upsertLocalExpense(expense: {
  id: string;
  note: string;
  amount: unknown;
  date: Date | string;
}) {
  patchSnapshot("expenses", {
    id: expense.id,
    note: expense.note,
    amount: toNum(expense.amount),
    date:
      expense.date instanceof Date
        ? expense.date.toISOString()
        : new Date(expense.date).toISOString(),
  });
}

export function clearLocalCashiersAndExpenses() {
  writeSnapshot("employees", []);
  writeSnapshot("expenses", []);
  try {
    localDb()
      .prepare("DELETE FROM known_users WHERE role = 'EMPLOYEE'")
      .run();
  } catch {
    // local catalog may not exist on this computer
  }
}

export function forgetLocalExpense(id: string) {
  const current = readSnapshot<{ id: string }[]>("expenses");
  if (!current) return;
  writeSnapshot(
    "expenses",
    current.filter((row) => row.id !== id)
  );
}

export function upsertLocalCategory(category: {
  id: string;
  name: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  _count?: { products: number };
}) {
  const now = new Date().toISOString();
  const current = readSnapshot<
    {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      _count: { products: number };
    }[]
  >("categories") || [];
  const previous = current.find((row) => row.id === category.id);
  const row = {
    id: category.id,
    name: category.name,
    createdAt:
      category.createdAt instanceof Date
        ? category.createdAt.toISOString()
        : category.createdAt || previous?.createdAt || now,
    updatedAt:
      category.updatedAt instanceof Date
        ? category.updatedAt.toISOString()
        : category.updatedAt || now,
    _count: category._count || previous?._count || { products: 0 },
  };
  const rest = current.filter((item) => item.id !== category.id);
  rest.push(row);
  rest.sort((a, b) => a.name.localeCompare(b.name));
  writeSnapshot("categories", rest);
}

export function forgetLocalCategory(id: string) {
  const current = readSnapshot<{ id: string }[]>("categories");
  if (!current) return;
  writeSnapshot(
    "categories",
    current.filter((row) => row.id !== id)
  );
}

export function upsertLocalContainer(container: {
  id: string;
  code: string;
  name: string;
  note: string | null;
  arrivedAt: Date | string | null;
  cost: unknown;
  totalDuty: unknown;
}) {
  const current = readSnapshot<ContainerHeader[]>("containers") || [];
  const row: ContainerHeader = {
    id: container.id,
    code: container.code,
    name: container.name,
    note: container.note,
    arrivedAt:
      container.arrivedAt instanceof Date
        ? container.arrivedAt.toISOString()
        : container.arrivedAt,
    cost: toNum(container.cost),
    totalDuty: toNum(container.totalDuty),
  };
  writeSnapshot("containers", [
    row,
    ...current.filter((item) => item.id !== container.id),
  ]);
}

export function forgetLocalContainer(id: string) {
  const current = readSnapshot<ContainerHeader[]>("containers");
  if (!current) return;
  writeSnapshot(
    "containers",
    current.filter((item) => item.id !== id)
  );
}

export function setLocalStock(productId: string, stock: number) {
  saveLocal(() => setLocalStockNow(productId, stock));
}

function setLocalStockNow(productId: string, stock: number) {
  const product = readProduct(productId);
  if (!product) return;
  const target = Math.max(0, Math.floor(stock));
  const lots = [...product.lots].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt)
  );
  const current = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const delta = target - current;
  if (delta > 0) {
    if (lots.length === 0) {
      lots.push({
        id: crypto.randomUUID(),
        containerId: product.containerId,
        containerCode: null,
        quantity: delta,
        cost: product.cost,
        customsDuty: product.customsDuty,
        receivedAt: new Date().toISOString(),
      });
    } else {
      lots[0].quantity += delta;
    }
  } else if (delta < 0) {
    let need = -delta;
    for (const lot of lots) {
      if (need <= 0) break;
      const take = Math.min(lot.quantity, need);
      lot.quantity -= take;
      need -= take;
    }
  }
  product.lots = lots;
  product.stock = target;
  saveProduct(product);
}

export function mirrorProductRecord(product: Parameters<typeof mirrorProductRecordNow>[0]) {
  saveLocal(() => mirrorProductRecordNow(product));
}

function mirrorProductRecordNow(product: {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: unknown;
  wholesalePrice: unknown;
  onlinePrice?: unknown;
  retailPrice?: unknown;
  maxDiscountPercent?: unknown;
  wholesaleMinQty: number;
  wholesaleMaxQty: number;
  stock: unknown;
  trackQty: boolean;
  active: boolean;
  showInPos: boolean;
  cost: unknown;
  customsDuty: unknown;
  containerId: string | null;
  lowStockAt?: number;
  maxStock?: number;
  description?: string | null;
  categoryId?: string | null;
  createdById?: string | null;
  category?: { name: string } | null;
  stockLots?: {
    id: string;
    containerId: string | null;
    quantity: number;
    cost: unknown;
    customsDuty: unknown;
    receivedAt: Date | string;
    container?: { code: string; name: string } | null;
  }[];
}) {
  const existing = readProduct(product.id);
  const stock = Math.max(0, Math.floor(toNum(product.stock)));
  const mirroredLots = product.stockLots
    ? product.stockLots.map((lot) => ({
        id: lot.id,
        containerId: lot.containerId,
        containerCode: lot.container?.name?.trim() || lot.container?.code || null,
        quantity: lot.quantity,
        cost: toNum(lot.cost),
        customsDuty: toNum(lot.customsDuty),
        receivedAt:
          lot.receivedAt instanceof Date
            ? lot.receivedAt.toISOString()
            : new Date(lot.receivedAt).toISOString(),
      }))
    : null;
  const lots = mirroredLots ?? existing?.lots ?? [];
  const stockNow = mirroredLots
    ? lots.reduce((sum, lot) => sum + Math.max(0, lot.quantity), 0)
    : (existing?.stock ?? stock);
  saveProduct({
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    unit: product.unit || "Pcs",
    price: toNum(product.price),
    wholesalePrice: toNum(product.wholesalePrice),
    onlinePrice: toNum(product.onlinePrice),
    retailPrice: toNum(product.retailPrice),
    maxDiscountPercent:
      product.maxDiscountPercent == null
        ? null
        : Math.min(100, Math.max(0, toNum(product.maxDiscountPercent))),
    wholesaleMinQty: product.wholesaleMinQty || 0,
    wholesaleMaxQty: product.wholesaleMaxQty || 0,
    stock: stockNow,
    trackQty: product.trackQty,
    active: product.active,
    showInPos: product.showInPos,
    cost: toNum(product.cost),
    customsDuty: toNum(product.customsDuty),
    containerId: product.containerId,
    lots,
  });
  const extra = localDb()
    .prepare(
      `SELECT category_name, low_stock_at, created_by_id, category_id, description, max_stock
       FROM catalog_products WHERE id = ?`
    )
    .get(product.id) as
    | {
        category_name: string | null;
        low_stock_at: number;
        created_by_id: string | null;
        category_id: string | null;
        description: string | null;
        max_stock: number;
      }
    | undefined;
  localDb()
    .prepare(
      `UPDATE catalog_products
       SET category_name = ?, low_stock_at = ?, created_by_id = ?,
           category_id = ?, description = ?, max_stock = ?
       WHERE id = ?`
    )
    .run(
      product.category?.name ?? extra?.category_name ?? null,
      product.lowStockAt ?? extra?.low_stock_at ?? 5,
      product.createdById !== undefined
        ? product.createdById
        : (extra?.created_by_id ?? null),
      product.categoryId !== undefined
        ? product.categoryId
        : (extra?.category_id ?? null),
      product.description !== undefined
        ? product.description
        : (extra?.description ?? null),
      product.maxStock ?? extra?.max_stock ?? 0,
      product.id
    );
  if (!mirroredLots) {
    const lotsEmpty = (existing?.lots.length ?? 0) === 0;
    if ((existing?.stock ?? stock) !== stock || (lotsEmpty && stock > 0)) {
      setLocalStock(product.id, stock);
    }
  }
}

export function forgetCatalogProduct(id: string) {
  saveLocal(() => {
    localDb().prepare("DELETE FROM catalog_products WHERE id = ?").run(id);
  });
}

export function readPaymentMethods() {
  return localDb()
    .prepare(
      "SELECT id, name FROM payment_methods WHERE active = 1 ORDER BY name"
    )
    .all() as { id: string; name: string }[];
}

export function readProduct(id: string) {
  const row = localDb()
    .prepare("SELECT * FROM catalog_products WHERE id = ?")
    .get(id) as ProductRow | undefined;
  return row ? rowToProduct(row) : null;
}

export function readItemEditor(id: string) {
  const row = localDb()
    .prepare("SELECT * FROM catalog_products WHERE id = ?")
    .get(id) as ProductRow | undefined;
  if (!row) return null;
  const product = rowToProduct(row);
  return {
    ...product,
    categoryId: row.category_id || "",
    description: row.description || "",
    maxStock: row.max_stock ?? 0,
    lowStockAt: row.low_stock_at ?? 5,
    createdById: row.created_by_id || null,
  };
}

export function saveProduct(product: CachedProduct) {
  localDb()
    .prepare(
      `INSERT INTO catalog_products (
        id, name, sku, barcode, unit, price, wholesale_price, wholesale_min_qty,
        wholesale_max_qty, stock, track_qty, active, show_in_pos, cost,
        customs_duty, container_id, lots_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        sku = excluded.sku,
        barcode = excluded.barcode,
        unit = excluded.unit,
        price = excluded.price,
        wholesale_price = excluded.wholesale_price,
        wholesale_min_qty = excluded.wholesale_min_qty,
        wholesale_max_qty = excluded.wholesale_max_qty,
        stock = excluded.stock,
        track_qty = excluded.track_qty,
        active = excluded.active,
        show_in_pos = excluded.show_in_pos,
        cost = excluded.cost,
        customs_duty = excluded.customs_duty,
        container_id = excluded.container_id,
        lots_json = excluded.lots_json,
        updated_at = excluded.updated_at`
    )
    .run(
      product.id,
      product.name,
      product.sku,
      product.barcode,
      product.unit,
      product.price,
      product.wholesalePrice,
      product.wholesaleMinQty,
      product.wholesaleMaxQty,
      product.stock,
      product.trackQty ? 1 : 0,
      product.active ? 1 : 0,
      product.showInPos ? 1 : 0,
      product.cost,
      product.customsDuty,
      product.containerId,
      JSON.stringify(product.lots),
      new Date().toISOString()
    );
  localDb()
    .prepare(
      `UPDATE catalog_products SET online_price = ?, retail_price = ?, max_discount_percent = ? WHERE id = ?`
    )
    .run(
      product.onlinePrice || 0,
      product.retailPrice || 0,
      product.maxDiscountPercent == null ? null : product.maxDiscountPercent,
      product.id
    );
}

export function searchCatalog(query: string) {
  const q = query.trim().toLowerCase();
  const db = localDb();
  if (!q) {
    return (
      db
        .prepare(
          `SELECT * FROM catalog_products
           WHERE active = 1 AND show_in_pos = 1
           ORDER BY name LIMIT 50`
        )
        .all() as ProductRow[]
    ).map(rowToProduct);
  }
  const exact = db
    .prepare(
      `SELECT * FROM catalog_products
       WHERE active = 1 AND show_in_pos = 1
         AND (lower(barcode) = ? OR lower(ifnull(sku, '')) = ? OR lower(name) = ?)
       LIMIT 1`
    )
    .get(q, q, q) as ProductRow | undefined;
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT * FROM catalog_products
       WHERE active = 1 AND show_in_pos = 1
         AND (
           lower(name) LIKE ? OR lower(ifnull(sku, '')) LIKE ?
           OR lower(ifnull(barcode, '')) LIKE ?
         )
       ORDER BY name LIMIT 50`
    )
    .all(like, like, like) as ProductRow[];
  const products = rows.map(rowToProduct);
  if (exact) {
    const found = rowToProduct(exact);
    if (!products.some((item) => item.id === found.id)) products.unshift(found);
  }
  return products;
}

export type LocalItemRow = {
  id: string;
  createdById: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  wholesalePrice: number;
  cost: number;
  customsDuty: number;
  stock: number;
  lowStockAt: number;
  active: boolean;
  showInPos: boolean;
  categoryName: string | null;
  containerCode: string | null;
};

function containerHeaders() {
  return (
    readSnapshot<
      { id: string; code: string; name: string }[]
    >("containers") || []
  );
}

function containerTitle(
  headers: { id: string; code: string; name: string }[],
  containerId: string | null,
  containerCode: string | null
) {
  const header = containerId
    ? headers.find((row) => row.id === containerId)
    : undefined;
  if (header?.name?.trim()) return header.name.trim();
  if (header?.code?.trim()) return header.code.trim();
  if (containerCode) return containerCode;
  return containerId ? "Container" : "No container";
}

function containerLabel(
  product: CachedProduct,
  headers: { id: string; code: string; name: string }[]
) {
  const parts = product.lots
    .filter((lot) => lot.quantity > 0)
    .map(
      (lot) =>
        `${containerTitle(headers, lot.containerId, lot.containerCode)} (${lot.quantity})`
    );
  if (parts.length > 0) return parts.join(", ");
  if (product.containerId) {
    return containerTitle(headers, product.containerId, null);
  }
  return null;
}

export function listLocalItems(): LocalItemRow[] {
  const headers = containerHeaders();
  const rows = localDb()
    .prepare("SELECT * FROM catalog_products ORDER BY name")
    .all() as ProductRow[];
  return rows.map((row) => {
    const product = rowToProduct(row);
    const positive = product.lots.filter((lot) => lot.quantity > 0);
    const next = positive[0];
    return {
      id: product.id,
      createdById: row.created_by_id || null,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      price: product.price,
      wholesalePrice: product.wholesalePrice,
      cost: next ? next.cost : product.cost,
      customsDuty: next ? next.customsDuty : product.customsDuty,
      stock: product.stock,
      lowStockAt: row.low_stock_at ?? 5,
      active: product.active,
      showInPos: product.showInPos,
      categoryName: row.category_name || null,
      containerCode: containerLabel(product, headers),
    };
  });
}

type ContainerHeader = {
  id: string;
  code: string;
  name: string;
  note: string | null;
  arrivedAt: string | null;
  cost: number;
  totalDuty: number;
};

export function listLocalContainers() {
  const headers = readSnapshot<ContainerHeader[]>("containers") || [];
  const byContainer = new Map<
    string,
    {
      productId: string;
      name: string;
      sku: string | null;
      barcode: string | null;
      quantity: number;
      cost: number;
      customsDuty: number;
    }[]
  >();
  for (const row of localDb()
    .prepare("SELECT * FROM catalog_products")
    .all() as ProductRow[]) {
    const product = rowToProduct(row);
    const grouped = new Map<
      string,
      {
        productId: string;
        name: string;
        sku: string | null;
        barcode: string | null;
        quantity: number;
        cost: number;
        customsDuty: number;
      }
    >();
    for (const lot of product.lots) {
      if (!lot.containerId || lot.quantity <= 0) continue;
      const current = grouped.get(lot.containerId);
      if (current) current.quantity += lot.quantity;
      else {
        grouped.set(lot.containerId, {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          quantity: lot.quantity,
          cost: lot.cost,
          customsDuty: lot.customsDuty,
        });
      }
    }
    for (const [containerId, item] of grouped) {
      const list = byContainer.get(containerId) || [];
      list.push(item);
      byContainer.set(containerId, list);
    }
  }
  const known = new Set(headers.map((header) => header.id));
  const rows = headers.map((header) => {
    const items = (byContainer.get(header.id) || []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    return { ...header, itemCount: items.length, items };
  });
  for (const [containerId, items] of byContainer) {
    if (known.has(containerId)) continue;
    const code = items[0] ? "Container" : "Container";
    rows.push({
      id: containerId,
      code,
      name: code,
      note: null,
      arrivedAt: null,
      cost: 0,
      totalDuty: 0,
      itemCount: items.length,
      items,
    });
  }
  return rows;
}

export function applyLocalStock<
  T extends { id: string; stock: number; containerCode?: string | null },
>(rows: T[]) {
  const local = localDb()
    .prepare("SELECT id, stock, lots_json, container_id FROM catalog_products")
    .all() as {
    id: string;
    stock: number;
    lots_json: string;
    container_id: string | null;
  }[];
  if (local.length === 0) return rows;
  const headers = containerHeaders();
  const stockById = new Map(
    local.map((row) => {
      const lots = JSON.parse(row.lots_json) as CachedLot[];
      const labeled = lots
        .filter((lot) => lot.quantity > 0)
        .map(
          (lot) =>
            `${containerTitle(headers, lot.containerId, lot.containerCode)} (${lot.quantity})`
        )
        .join(", ");
      const containerCode =
        labeled ||
        (row.container_id
          ? containerTitle(headers, row.container_id, null)
          : null);
      return [row.id, { stock: row.stock, containerCode }] as const;
    })
  );
  return rows.map((row) => {
    const found = stockById.get(row.id);
    if (!found) return row;
    if (!("containerCode" in row)) return { ...row, stock: found.stock };
    return { ...row, stock: found.stock, containerCode: found.containerCode };
  });
}

function pendingProductIds() {
  const rows = localDb()
    .prepare(
      "SELECT payload_json FROM local_sales WHERE sync_status IN ('pending', 'failed')"
    )
    .all() as { payload_json: string }[];
  return productIdsIn(rows);
}

function recentSaleProductIds() {
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const rows = localDb()
    .prepare("SELECT payload_json FROM local_sales WHERE created_at >= ?")
    .all(since) as { payload_json: string }[];
  return productIdsIn(rows);
}

function productIdsIn(rows: { payload_json: string }[]) {
  const ids = new Set<string>();
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json) as {
      items?: { productId?: string }[];
    };
    for (const item of payload.items || []) {
      if (item.productId) ids.add(item.productId);
    }
  }
  return ids;
}

export async function refreshCatalogFromSupabase() {
  const [products, methods, settings, categories, containers, expenses, employees, sales] =
    await Promise.all([
    prisma.product.findMany({
      include: {
        category: true,
        stockLots: {
          orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
          include: { container: { select: { code: true } } },
        },
      },
    }),
    prisma.paymentMethod.findMany({ orderBy: { name: "asc" } }),
    prisma.storeSettings.findUnique({ where: { id: "default" } }),
    prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.container.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.expense.findMany({ orderBy: { date: "desc" }, take: 200 }),
    prisma.user.findMany({
      where: { role: "EMPLOYEE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
        passwordHash: true,
        role: true,
      },
    }),
    prisma.sale.findMany({
      include: {
        cashier: { select: { name: true } },
        customer: { select: { name: true } },
        paymentMethod: { select: { name: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  const held = pendingProductIds();
  const recent = recentSaleProductIds();
  const localBefore = new Map(
    (
      localDb()
        .prepare("SELECT id, stock FROM catalog_products")
        .all() as { id: string; stock: number }[]
    ).map((row) => [row.id, row.stock])
  );
  const db = localDb();
  db.exec("BEGIN");
  try {
    const seen = new Set<string>();
    const upsert = db.prepare(
      `INSERT INTO catalog_products (
        id, name, sku, barcode, unit, price, wholesale_price, wholesale_min_qty,
        wholesale_max_qty, stock, track_qty, active, show_in_pos, cost,
        customs_duty, container_id, lots_json, updated_at, category_name,
        low_stock_at, created_by_id, category_id, description, max_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        sku = excluded.sku,
        barcode = excluded.barcode,
        unit = excluded.unit,
        price = excluded.price,
        wholesale_price = excluded.wholesale_price,
        wholesale_min_qty = excluded.wholesale_min_qty,
        wholesale_max_qty = excluded.wholesale_max_qty,
        stock = CASE WHEN ? = 1 THEN catalog_products.stock ELSE excluded.stock END,
        track_qty = excluded.track_qty,
        active = excluded.active,
        show_in_pos = excluded.show_in_pos,
        cost = excluded.cost,
        customs_duty = excluded.customs_duty,
        container_id = excluded.container_id,
        lots_json = CASE WHEN ? = 1 THEN catalog_products.lots_json ELSE excluded.lots_json END,
        updated_at = excluded.updated_at,
        category_name = excluded.category_name,
        low_stock_at = excluded.low_stock_at,
        created_by_id = excluded.created_by_id,
        category_id = excluded.category_id,
        description = excluded.description,
        max_stock = excluded.max_stock`
    );
    for (const product of products) {
      seen.add(product.id);
      const localStock = localBefore.get(product.id);
      const serverStock = product.stock;
      const keepLowerLocal =
        recent.has(product.id) &&
        localStock != null &&
        localStock < serverStock;
      const hold = held.has(product.id) || keepLowerLocal ? 1 : 0;
      const lots: CachedLot[] = product.stockLots.map((lot) => ({
        id: lot.id,
        containerId: lot.containerId,
        containerCode: lot.container?.code ?? null,
        quantity: lot.quantity,
        cost: toNum(lot.cost),
        customsDuty: toNum(lot.customsDuty),
        receivedAt: lot.receivedAt.toISOString(),
      }));
      upsert.run(
        product.id,
        product.name,
        product.sku,
        product.barcode,
        product.unit || "Pcs",
        toNum(product.price),
        toNum(product.wholesalePrice),
        product.wholesaleMinQty,
        product.wholesaleMaxQty,
        product.stock,
        product.trackQty ? 1 : 0,
        product.active ? 1 : 0,
        product.showInPos ? 1 : 0,
        toNum(product.cost),
        toNum(product.customsDuty),
        product.containerId,
        JSON.stringify(lots),
        new Date().toISOString(),
        product.category?.name || null,
        product.lowStockAt,
        product.createdById,
        product.categoryId,
        product.description,
        product.maxStock,
        hold,
        hold
      );
      db.prepare(
        `UPDATE catalog_products SET online_price = ?, retail_price = ?, max_discount_percent = ? WHERE id = ?`
      ).run(
        toNum(product.onlinePrice),
        toNum(product.retailPrice),
        product.maxDiscountPercent == null ? null : toNum(product.maxDiscountPercent),
        product.id
      );
    }
    if (held.size === 0) {
      const existing = db
        .prepare("SELECT id FROM catalog_products")
        .all() as { id: string }[];
      const remove = db.prepare("DELETE FROM catalog_products WHERE id = ?");
      for (const row of existing) {
        if (!seen.has(row.id)) remove.run(row.id);
      }
    }
    db.prepare("DELETE FROM payment_methods").run();
    const insertMethod = db.prepare(
      "INSERT INTO payment_methods (id, name, active) VALUES (?, ?, ?)"
    );
    for (const method of methods) {
      insertMethod.run(method.id, method.name, method.active ? 1 : 0);
    }
    const snapshot: CachedSettings = {
      storeName: settings?.storeName || "VANO",
      currency: settings?.currency || "USD",
      usdToLbpRate: toNum(settings?.usdToLbpRate) || 89500,
      taxRate: toNum(settings?.taxRate),
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      receiptFooter: settings?.receiptFooter ?? null,
      discAbove500: toNum(settings?.discAbove500),
      discAbove1000: toNum(settings?.discAbove1000),
      discAbove3000: toNum(settings?.discAbove3000),
      discAbove5000: toNum(settings?.discAbove5000),
      discAbove7000: toNum(settings?.discAbove7000),
      discAbove10000: toNum(settings?.discAbove10000),
    };
    db.prepare(
      "INSERT INTO settings_cache (id, json) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json"
    ).run(JSON.stringify(snapshot));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  setMeta("catalog_synced_at", new Date().toISOString());
  writeSnapshot(
    "categories",
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
      _count: category._count,
    }))
  );
  writeSnapshot(
    "containers",
    containers.map((container) => ({
      id: container.id,
      code: container.code,
      name: container.name,
      note: container.note,
      arrivedAt: container.arrivedAt ? container.arrivedAt.toISOString() : null,
      cost: toNum(container.cost),
      totalDuty: toNum(container.totalDuty),
    }))
  );
  writeSnapshot(
    "expenses",
    expenses.map((expense) => ({
      id: expense.id,
      note: expense.note,
      amount: toNum(expense.amount),
      date: expense.date.toISOString(),
    }))
  );
  writeSnapshot(
    "employees",
    employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      active: employee.active,
      createdAt: employee.createdAt.toISOString(),
    }))
  );
  for (const employee of employees) {
    rememberUser({
      id: employee.id,
      name: employee.name,
      email: employee.email,
      passwordHash: employee.passwordHash,
      role: employee.role,
      active: employee.active,
    });
  }
  writeSnapshot(
    "payment-methods",
    methods.map((method) => ({
      id: method.id,
      name: method.name,
      active: method.active,
      createdAt: method.createdAt.toISOString(),
      updatedAt: method.updatedAt.toISOString(),
    }))
  );
  writeSnapshot(
    "sales",
    sales.map((sale) => ({
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      total: toNum(sale.total),
      createdAt: sale.createdAt.toISOString(),
      cashierId: sale.cashierId,
      cashierName: sale.cashier.name,
      customerName: sale.customer?.name || "Walk-in",
      paymentName: sale.paymentMethod.name,
      itemCount: sale.items.length,
      cogs: sale.items.reduce(
        (sum, item) => sum + toNum(item.unitCost) * item.quantity,
        0
      ),
      items: sale.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        lineTotal: toNum(item.lineTotal),
        unitCost: toNum(item.unitCost),
      })),
    }))
  );
  return products.length;
}

export function rememberUser(user: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  active: boolean;
}) {
  saveLocal(() => {
    const db = localDb();
    const email = user.email.toLowerCase();
    db.prepare("DELETE FROM known_users WHERE email = ? AND id != ?").run(
      email,
      user.id
    );
    db.prepare(
      `INSERT INTO known_users (id, name, email, password_hash, role, active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         password_hash = excluded.password_hash,
         role = excluded.role,
         active = excluded.active`
    ).run(
      user.id,
      user.name,
      email,
      user.passwordHash,
      user.role,
      user.active ? 1 : 0
    );
  });
}

export function findKnownUser(email: string) {
  return localDb()
    .prepare(
      "SELECT id, name, email, password_hash AS passwordHash, role, active FROM known_users WHERE email = ?"
    )
    .get(email.trim().toLowerCase()) as
    | {
        id: string;
        name: string;
        email: string;
        passwordHash: string;
        role: string;
        active: number;
      }
    | undefined;
}

export function findKnownUserById(id: string) {
  return localDb()
    .prepare(
      "SELECT id, name, email, password_hash AS passwordHash, role, active FROM known_users WHERE id = ?"
    )
    .get(id) as
    | {
        id: string;
        name: string;
        email: string;
        passwordHash: string;
        role: string;
        active: number;
      }
    | undefined;
}
