import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";
import { bustCache } from "@/lib/data-cache";
import { notifyOwners } from "@/lib/push";
import { mirrorProductRecord } from "@/lib/catalog-cache";
import {
  parseLotRows,
  refreshProductFromLots,
  syncProductLots,
  withContainerCustoms,
} from "@/lib/stock-lots";
import { newStoreBarcode } from "@/lib/store-barcode";
import { parseMaxDiscount } from "@/lib/price-tiers";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { holdProduct } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
export async function GET(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { sku: { contains: q, mode: "insensitive" as const } },
            { barcode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : undefined;

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { name: "asc" },
    });

    return jsonMoney({ products });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const held: { body?: Record<string, unknown>; userId?: string } = {};
  try {
    const user = await requireRole(Role.OWNER);
    const body = await request.json();
    held.body = body;
    held.userId = user.id;

    const name = String(body.name || "").trim();
    const price = Number(body.price);
    const cost = Number(body.cost ?? 0);
    const customsDuty = Number(body.customsDuty ?? 0);
    const wholesalePrice = Number(body.wholesalePrice ?? 0);
    const onlinePrice = Number(body.onlinePrice ?? 0);
    const retailPrice = Number(body.retailPrice ?? 0);
    const maxDiscountPercent = parseMaxDiscount(body.maxDiscountPercent);
    const wholesaleMinQty = Math.max(0, Math.floor(Number(body.wholesaleMinQty ?? 0)));
    const wholesaleMaxQty = Math.max(0, Math.floor(Number(body.wholesaleMaxQty ?? 0)));
    const stock = Number(body.stock ?? 0);
    const lowStockAt = Number(body.lowStockAt ?? 0);
    const maxStock = Number(body.maxStock ?? 0);
    const sku = body.sku ? String(body.sku).trim() : null;
    const barcode = body.barcode ? String(body.barcode).trim() : null;
    const unit = body.unit ? String(body.unit).trim() : "Pcs";
    const description = body.description
      ? String(body.description).trim()
      : null;
    const categoryId = body.categoryId || null;
    const containerId = body.containerId || null;

    if (!name) {
      return NextResponse.json({ error: "Item name is required" }, { status: 400 });
    }
    if (Number.isNaN(price) || price < 0) {
      return NextResponse.json(
        { error: "Valid name and price are required" },
        { status: 400 }
      );
    }
    if (wholesaleMaxQty > 0 && wholesaleMinQty > wholesaleMaxQty) {
      return NextResponse.json(
        { error: "Wholesale min qty cannot be greater than max qty" },
        { status: 400 }
      );
    }

    if (sku) {
      const existingSku = await prisma.product.findUnique({ where: { sku } });
      if (existingSku) {
        return NextResponse.json(
          {
            error: `Item code "${sku}" is already used. Choose a different Code.`,
          },
          { status: 400 }
        );
      }
    }

    let storeBarcode = barcode;
    if (storeBarcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { barcode: storeBarcode },
      });
      if (existingBarcode) {
        return NextResponse.json(
          {
            error: `Barcode "${storeBarcode}" is already used by "${existingBarcode.name}".`,
          },
          { status: 400 }
        );
      }
    } else {
      const existing = await prisma.product.findMany({
        where: { barcode: { not: null } },
        select: { barcode: true },
      });
      const taken = new Set(
        existing
          .map((product) => product.barcode)
          .filter((code): code is string => Boolean(code))
      );
      storeBarcode = newStoreBarcode(taken);
    }

    const parsedLots = parseLotRows(body.lots);
    const lots = parsedLots ? await withContainerCustoms(parsedLots) : null;
    const duty = Number.isNaN(customsDuty) ? 0 : customsDuty;
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name,
          price,
          cost: Number.isNaN(cost) ? 0 : cost,
          customsDuty: duty,
          wholesalePrice: Number.isNaN(wholesalePrice) ? 0 : wholesalePrice,
          onlinePrice: Number.isNaN(onlinePrice) ? 0 : onlinePrice,
          retailPrice: Number.isNaN(retailPrice) ? 0 : retailPrice,
          maxDiscountPercent,
          wholesaleMinQty,
          wholesaleMaxQty,
          stock: Number.isNaN(stock) ? 0 : stock,
          lowStockAt: Number.isNaN(lowStockAt) ? 0 : lowStockAt,
          maxStock: Number.isNaN(maxStock) ? 0 : maxStock,
          sku,
          barcode: storeBarcode,
          unit: unit || "Pcs",
          description,
          categoryId,
          containerId,
          active: body.active !== false,
          showInPos: body.showInPos !== false,
          trackQty: body.trackQty !== false,
          createdById: user.id,
        },
      });
      if (lots && lots.length > 0) {
        await syncProductLots(tx, created.id, lots);
      } else if ((Number.isNaN(stock) ? 0 : stock) > 0 || containerId) {
        await tx.stockLot.create({
          data: {
            productId: created.id,
            containerId,
            quantity: Number.isNaN(stock) ? 0 : Math.max(0, Math.floor(stock)),
            cost: Number.isNaN(cost) ? 0 : cost,
            customsDuty: duty,
          },
        });
        await refreshProductFromLots(tx, created.id);
      }
      return tx.product.findUnique({
        where: { id: created.id },
        include: {
          category: true,
          stockLots: {
            orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
            include: { container: { select: { code: true, name: true } } },
          },
        },
      });
    });

    if (product) {
      mirrorProductRecord(product);
      notifyOwners({
        title: "Product update",
        body: `${product.name} added at $${Number(product.price).toFixed(2)}, stock ${product.stock}`,
        url: `/items/${product.id}`,
        tag: `product:${product.id}`,
      });
    }
    bustCache("products", "owner-stats");
    return jsonMoney({ product }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Item code or barcode already exists" },
        { status: 400 }
      );
    }
    if (isDbUnavailable(error) && held.body) {
      const saved = holdProduct(held.body, crypto.randomUUID(), held.userId || null);
      void syncPendingSales();
      notifyOwners({
        title: "Product update",
        body: `${String(saved.name || "Item")} was added`,
        url: `/items/${saved.id}`,
        tag: `product:${saved.id}`,
      });
      return jsonMoney({ product: saved }, { status: 201 });
    }
    return authErrorResponse(error);
  }
}
