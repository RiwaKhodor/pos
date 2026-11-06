import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./prisma";
import { toNum } from "./money";
import { DEFAULT_USD_TO_LBP } from "./fx";
import { formatContainerStock } from "./stock-lots";

export function bustCache(...tags: string[]) {
  try {
    for (const tag of tags) {
      revalidateTag(tag, { expire: 0 });
    }
  } catch (error) {
    console.error(error);
  }
}

export const getCachedStoreSettings = unstable_cache(
  async () => {
    let settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    if (!settings) {
      settings = await prisma.storeSettings.create({ data: { id: "default" } });
    }
    return {
      storeName: settings.storeName,
      usdToLbpRate: toNum(settings.usdToLbpRate) || DEFAULT_USD_TO_LBP,
      taxRate: toNum(settings.taxRate),
      receiptFooter: settings.receiptFooter,
      discAbove500: toNum(settings.discAbove500),
      discAbove1000: toNum(settings.discAbove1000),
      discAbove3000: toNum(settings.discAbove3000),
      discAbove5000: toNum(settings.discAbove5000),
      discAbove7000: toNum(settings.discAbove7000),
      discAbove10000: toNum(settings.discAbove10000),
    };
  },
  ["store-settings"],
  { revalidate: 60, tags: ["settings"] }
);

export const getCachedCategories = unstable_cache(
  async () => {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      _count: c._count,
    }));
  },
  ["categories-list"],
  { revalidate: 60, tags: ["categories"] }
);

export const getCachedPaymentMethods = unstable_cache(
  async () => {
    const methods = await prisma.paymentMethod.findMany({
      orderBy: { name: "asc" },
    });
    return methods.map((m) => ({
      id: m.id,
      name: m.name,
      active: m.active,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));
  },
  ["payment-methods-list"],
  { revalidate: 60, tags: ["payment-methods"] }
);

export const getCachedContainerOptions = unstable_cache(
  async () => {
    const containers = await prisma.container.findMany({
      orderBy: { code: "asc" },
    });
    return containers.map((container) => ({
      id: container.id,
      code: container.code,
      name: container.name,
      cost: toNum(container.cost),
      totalDuty: toNum(container.totalDuty),
    }));
  },
  ["container-options"],
  { revalidate: 60, tags: ["products"] }
);

export const getCachedItems = unstable_cache(
  async () => {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        stockLots: {
          include: { container: { select: { code: true } } },
          orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    return products.map((p) => {
      const positive = p.stockLots.filter((lot) => lot.quantity > 0);
      const next = positive[0];
      const stock = p.stockLots.length
        ? positive.reduce((sum, lot) => sum + lot.quantity, 0)
        : p.stock;
      return {
        id: p.id,
        createdById: p.createdById,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        price: toNum(p.price),
        wholesalePrice: toNum(p.wholesalePrice),
        cost: next ? toNum(next.cost) : toNum(p.cost),
        customsDuty: next ? toNum(next.customsDuty) : toNum(p.customsDuty),
        stock,
        lowStockAt: p.lowStockAt,
        active: p.active,
        showInPos: p.showInPos,
        categoryName: p.category?.name || null,
        containerCode: formatContainerStock(
          p.stockLots.map((lot) => ({
            quantity: lot.quantity,
            containerCode: lot.container?.code || null,
          }))
        ),
      };
    });
  },
  ["items-list"],
  { revalidate: 30, tags: ["products"] }
);

export const getCachedExpenses = unstable_cache(
  async () => {
    const expenses = await prisma.expense.findMany({
      orderBy: { date: "desc" },
      take: 200,
    });
    return expenses.map((e) => ({
      id: e.id,
      note: e.note,
      amount: toNum(e.amount),
      date: e.date.toISOString(),
    }));
  },
  ["expenses-list"],
  { revalidate: 30, tags: ["expenses"] }
);

export const getCachedInventory = unstable_cache(
  async () => {
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: { stock: "asc" },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      stock: p.stock,
      lowStockAt: p.lowStockAt,
      categoryName: p.category?.name || null,
    }));
  },
  ["inventory-list"],
  { revalidate: 30, tags: ["products"] }
);

export const getCachedEmployees = unstable_cache(
  async () => {
    const employees = await prisma.user.findMany({
      where: { role: "EMPLOYEE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
      },
    });
    return employees.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    }));
  },
  ["employees-list"],
  { revalidate: 60, tags: ["employees"] }
);

export const getCachedOwnerStats = unstable_cache(
  async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const [revenueAgg, cogsRows, expenseAgg, lowStockRows] = await Promise.all([
      prisma.sale.aggregate({
        where: { createdAt: { gte: start, lte: end } },
        _sum: { total: true },
      }),
      prisma.$queryRaw<[{ cogs: unknown }]>`
        SELECT COALESCE(SUM(si."unitCost" * si.quantity), 0) AS cogs
        FROM "SaleItem" si
        INNER JOIN "Sale" s ON s.id = si."saleId"
        WHERE s."createdAt" >= ${start} AND s."createdAt" <= ${end}
      `,
      prisma.expense.aggregate({
        where: { date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count FROM "Product"
        WHERE active = true AND stock <= "lowStockAt"
      `,
    ]);
    return {
      revenue: toNum(revenueAgg._sum.total ?? 0),
      cogs: toNum(cogsRows[0]?.cogs ?? 0),
      expenseTotal: toNum(expenseAgg._sum.amount ?? 0),
      lowStock: Number(lowStockRows[0]?.count ?? 0),
    };
  },
  ["owner-stats"],
  { revalidate: 20, tags: ["owner-stats", "products", "expenses"] }
);

export const getCachedPosBootstrap = unstable_cache(
  async () => {
    const [products, methods] = await Promise.all([
      prisma.product.findMany({
        where: { active: true, showInPos: true, price: { gt: 0 } },
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          unit: true,
          price: true,
          wholesalePrice: true,
          wholesaleMinQty: true,
          wholesaleMaxQty: true,
          stock: true,
          trackQty: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
        take: 50,
      }),
      prisma.paymentMethod.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return {
      products: products.map((p) => ({
        ...p,
        price: toNum(p.price),
        wholesalePrice: toNum(p.wholesalePrice),
      })),
      methods,
    };
  },
  ["pos-bootstrap"],
  { revalidate: 20, tags: ["products", "payment-methods"] }
);
