import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";
import { bustCache } from "@/lib/data-cache";
import { lotDb, setStockQuantity } from "@/lib/stock-lots";
import { setLocalStock } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { category: true },
      orderBy: { stock: "asc" },
    });

    const lowStock = products.filter((p) => p.stock <= p.lowStockAt);
    return jsonMoney({ products, lowStock });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const held: { id?: string; stock?: number } = {};
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const id = String(body.id || "");
    const stock = Number(body.stock);
    held.id = id;
    held.stock = stock;

    if (!id || Number.isNaN(stock) || stock < 0) {
      return NextResponse.json(
        { error: "Valid product id and stock are required" },
        { status: 400 }
      );
    }

    const current = await prisma.product.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    await setStockQuantity(lotDb(), current, stock);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });

    if (product) setLocalStock(product.id, toNum(product.stock));
    bustCache("products", "owner-stats");
    if (current.stock !== stock) {
      notifyOwners({
        title: "Stock change",
        body: `${current.name}: stock ${current.stock} → ${stock}`,
        url: "/items",
        tag: `stock:${id}:${Date.now()}`,
      });
    }
    return jsonMoney({ product });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (isDbUnavailable(error) && held.id && held.stock != null && !Number.isNaN(held.stock)) {
      setLocalStock(held.id, held.stock);
      queueOp(`stock:${held.id}`, "stock.set", { id: held.id, stock: held.stock });
      void syncPendingSales();
      notifyOwners({
        title: "Stock change",
        body: `Stock is now ${held.stock}`,
        url: "/inventory",
        tag: `stock:${held.id}`,
      });
      return jsonMoney({ product: { id: held.id, stock: held.stock } });
    }
    return authErrorResponse(error);
  }
}
