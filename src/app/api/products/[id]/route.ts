import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { forgetCatalogProduct, mirrorProductRecord, readProduct } from "@/lib/catalog-cache";
import { notifyOwners } from "@/lib/push";
import { jsonMoney } from "@/lib/money";
import { parseMaxDiscount } from "@/lib/price-tiers";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { holdProduct, queueDelete } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import {
  ensureOpeningLot,
  parseLotRows,
  refreshProductFromLots,
  setStockQuantity,
  syncProductLots,
  withContainerCustoms,
} from "@/lib/stock-lots";

type Params = { params: Promise<{ id: string }> };

function noteItemChange(
  id: string,
  name: string,
  before: {
    name?: string;
    price: number;
    wholesalePrice: number;
    onlinePrice: number;
    retailPrice: number;
    stock: number;
  } | null,
  body: Record<string, unknown>
) {
  const parts: string[] = [];
  const money = (value: number) => value.toFixed(2);
  if (before && body.name !== undefined && String(body.name) !== before.name) {
    parts.push(`name is now ${body.name}`);
  }
  const prices = [
    ["price", "price"],
    ["wholesalePrice", "wholesale price"],
    ["onlinePrice", "online price"],
    ["retailPrice", "retail price"],
  ] as const;
  for (const [field, label] of prices) {
    if (!before || body[field] === undefined) continue;
    const next = Number(body[field] || 0);
    if (next !== Number(before[field] || 0)) {
      parts.push(`${label} ${money(Number(before[field] || 0))} → ${money(next)}`);
    }
  }
  if (before && body.stock !== undefined && Number(body.stock) !== before.stock) {
    parts.push(`stock ${before.stock} → ${body.stock}`);
  }
  if (before && body.active !== undefined && Boolean(body.active) !== Boolean((before as { active?: boolean }).active)) {
    parts.push(body.active ? "marked active" : "marked inactive");
  }
  notifyOwners({
    title: parts.some((part) => part.startsWith("price") || part.includes("price"))
      ? "Price change"
      : parts.some((part) => part.startsWith("stock"))
        ? "Stock change"
        : "Item updated",
    body: parts.length > 0 ? `${name}: ${parts.join("; ")}` : `${name} was updated`,
    url: "/items",
    tag: `item:${id}:${Date.now()}`,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const held: { body?: Record<string, unknown>; id?: string; userId?: string } = {};
  try {
    const user = await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();
    held.body = body;
    held.id = id;
    held.userId = user.id;

    if (user.role === Role.EMPLOYEE && !body.appendLot && !body.lots) {
      const existing = await prisma.product.findUnique({
        where: { id },
        select: { createdById: true, price: true, name: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      if (existing.createdById !== user.id) {
        return NextResponse.json(
          { error: "You can only correct an item you added." },
          { status: 403 }
        );
      }
      const name = String(body.name || "").trim();
      const barcode = String(body.barcode || "").trim();
      const price = Number(body.price);
      if (!name) {
        return NextResponse.json({ error: "Item name is required" }, { status: 400 });
      }
      if (!barcode) {
        return NextResponse.json({ error: "Barcode is required" }, { status: 400 });
      }
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: "Enter a valid price" }, { status: 400 });
      }
      const taken = await prisma.product.findFirst({
        where: { barcode, NOT: { id } },
      });
      if (taken) {
        return NextResponse.json(
          { error: `Barcode "${barcode}" is already used by "${taken.name}".` },
          { status: 400 }
        );
      }
      const product = await prisma.product.update({
        where: { id },
        data: { name, barcode, price },
        include: { category: true },
      });
      mirrorProductRecord(product);
      bustCache("products", "owner-stats");
      if (Number(existing.price) !== price) {
        notifyOwners({
          title: "Price change",
          body: `${product.name} price was updated`,
          url: `/items/${id}`,
          tag: `price:${id}`,
        });
      } else {
        notifyOwners({
          title: "Product update",
          body: `${product.name} was updated`,
          url: `/items/${id}`,
          tag: `product:${id}`,
        });
      }
      return jsonMoney({ product });
    }

    const before = readProduct(id);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.price !== undefined) data.price = Number(body.price);
    if (body.cost !== undefined) data.cost = Number(body.cost);
    if (body.customsDuty !== undefined) data.customsDuty = Number(body.customsDuty);
    if (body.wholesalePrice !== undefined) {
      data.wholesalePrice = Number(body.wholesalePrice);
    }
    if (body.onlinePrice !== undefined) data.onlinePrice = Number(body.onlinePrice || 0);
    if (body.retailPrice !== undefined) data.retailPrice = Number(body.retailPrice || 0);
    if (body.maxDiscountPercent !== undefined) {
      data.maxDiscountPercent = parseMaxDiscount(body.maxDiscountPercent);
    }
    if (body.wholesaleMinQty !== undefined) {
      data.wholesaleMinQty = Math.max(
        0,
        Math.floor(Number(body.wholesaleMinQty) || 0)
      );
    }
    if (body.wholesaleMaxQty !== undefined) {
      data.wholesaleMaxQty = Math.max(
        0,
        Math.floor(Number(body.wholesaleMaxQty) || 0)
      );
    }
    if (body.stock !== undefined) data.stock = Number(body.stock);
    if (body.lowStockAt !== undefined) data.lowStockAt = Number(body.lowStockAt);
    if (body.maxStock !== undefined) data.maxStock = Number(body.maxStock);
    if (body.sku !== undefined) {
      data.sku = body.sku ? String(body.sku).trim() : null;
    }
    if (body.barcode !== undefined) {
      data.barcode = body.barcode ? String(body.barcode).trim() : null;
    }
    if (body.unit !== undefined) {
      data.unit = body.unit ? String(body.unit).trim() : "Pcs";
    }
    if (body.description !== undefined) {
      data.description = body.description
        ? String(body.description).trim()
        : null;
    }
    if (body.categoryId !== undefined) {
      data.categoryId = body.categoryId || null;
    }
    if (body.containerId !== undefined) {
      data.containerId = body.containerId || null;
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.showInPos !== undefined) data.showInPos = Boolean(body.showInPos);
    if (body.trackQty !== undefined) data.trackQty = Boolean(body.trackQty);

    if (typeof data.sku === "string" && data.sku) {
      const existingSku = await prisma.product.findFirst({
        where: { sku: data.sku, NOT: { id } },
      });
      if (existingSku) {
        return NextResponse.json(
          {
            error: `Item code "${data.sku}" is already used. Choose a different Code.`,
          },
          { status: 400 }
        );
      }
    }

    if (typeof data.barcode === "string" && data.barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { barcode: data.barcode, NOT: { id } },
      });
      if (existingBarcode) {
        return NextResponse.json(
          {
            error: `Barcode "${data.barcode}" is already used by "${existingBarcode.name}".`,
          },
          { status: 400 }
        );
      }
    }

    if (
      typeof data.wholesaleMinQty === "number" &&
      typeof data.wholesaleMaxQty === "number" &&
      data.wholesaleMaxQty > 0 &&
      data.wholesaleMinQty > data.wholesaleMaxQty
    ) {
      return NextResponse.json(
        { error: "Wholesale min qty cannot be greater than max qty" },
        { status: 400 }
      );
    }

    const appendLot = body.appendLot
      ? {
          containerId: body.appendLot.containerId
            ? String(body.appendLot.containerId)
            : null,
          quantity: Math.max(0, Math.floor(Number(body.appendLot.quantity) || 0)),
          cost: Number(body.appendLot.cost) || 0,
          customsDuty: Number(body.appendLot.customsDuty) || 0,
        }
      : null;
    if (appendLot && appendLot.quantity <= 0) {
      return NextResponse.json(
        { error: "Enter how many pieces arrived" },
        { status: 400 }
      );
    }

    const parsedLots = appendLot ? null : parseLotRows(body.lots);
    const lots = parsedLots ? await withContainerCustoms(parsedLots) : null;
    if (appendLot?.containerId) {
      const [priced] = await withContainerCustoms([
        {
          id: null,
          containerId: appendLot.containerId,
          quantity: appendLot.quantity,
          cost: appendLot.cost,
          customsDuty: appendLot.customsDuty,
        },
      ]);
      appendLot.customsDuty = priced.customsDuty;
    }
    const arrival = appendLot;
    if (lots) {
      delete data.stock;
      delete data.cost;
      delete data.customsDuty;
      delete data.containerId;
    }

    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id } });
      if (!current) throw new Error("NOT_FOUND");
      await tx.product.update({ where: { id }, data });

      if (appendLot && arrival) {
        await tx.stockLot.create({
          data: {
            productId: id,
            containerId: appendLot.containerId,
            quantity: appendLot.quantity,
            cost: arrival.cost,
            customsDuty: arrival.customsDuty,
            receivedAt: new Date(),
          },
        });
        await refreshProductFromLots(tx, id);
      } else if (lots) {
        await syncProductLots(tx, id, lots);
      } else if (
        body.stock !== undefined ||
        body.cost !== undefined ||
        body.customsDuty !== undefined ||
        body.containerId !== undefined
      ) {
        const fresh = await tx.product.findUnique({ where: { id } });
        if (fresh) {
          if (body.stock !== undefined) {
            await setStockQuantity(tx, fresh, Number(body.stock));
          } else {
            await ensureOpeningLot(tx, fresh);
          }
          const positive = await tx.stockLot.findMany({
            where: { productId: id, quantity: { gt: 0 } },
            orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
          });
          const target = positive[0];
          if (target) {
            await tx.stockLot.update({
              where: { id: target.id },
              data: {
                ...(body.cost !== undefined ? { cost: Number(body.cost) } : {}),
                ...(body.customsDuty !== undefined
                  ? { customsDuty: Number(body.customsDuty) }
                  : {}),
                ...(positive.length === 1 && body.containerId !== undefined
                  ? { containerId: body.containerId || null }
                  : {}),
              },
            });
            await refreshProductFromLots(tx, id);
          }
        }
      }

      return tx.product.findUnique({
        where: { id },
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
      noteItemChange(id, product.name, before, body);
    }
    bustCache("products", "owner-stats");
    return jsonMoney({ product });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Item code or barcode already exists" },
        { status: 400 }
      );
    }
    if (isDbUnavailable(error) && held.body && held.id) {
      const before = readProduct(held.id);
      const saved = holdProduct(held.body, held.id, held.userId || null);
      void syncPendingSales();
      noteItemChange(
        held.id,
        String(saved.name || held.body.name || "Item"),
        before,
        held.body
      );
      return jsonMoney({ product: saved });
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  let itemId = "";
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    itemId = id;

    const removedName = readProduct(id)?.name || "An item";
    const sold = await prisma.saleItem.count({ where: { productId: id } });
    if (sold > 0) {
      return NextResponse.json(
        {
          error:
            "This item was used in sales. Mark it Inactive instead of deleting.",
        },
        { status: 400 }
      );
    }

    await prisma.product.delete({ where: { id } });
    forgetCatalogProduct(id);
    bustCache("products", "owner-stats");
    notifyOwners({
      title: "Item removed",
      body: `${removedName} was removed`,
      url: "/items",
      tag: `item:${id}:${Date.now()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDbUnavailable(error) && itemId) {
      const removedName = readProduct(itemId)?.name || "An item";
      forgetCatalogProduct(itemId);
      queueDelete(`product:${itemId}`, "product.delete", { id: itemId });
      void syncPendingSales();
      bustCache("products", "owner-stats");
      notifyOwners({
        title: "Item removed",
        body: `${removedName} was removed`,
        url: "/items",
        tag: `item:${itemId}:${Date.now()}`,
      });
      return NextResponse.json({ ok: true });
    }
    return authErrorResponse(error);
  }
}
