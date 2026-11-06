import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";
import { bustCache } from "@/lib/data-cache";
import { restoreSaleItemStock } from "@/lib/stock-lots";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";
import { dropLocalSale, readLocalSale, restoreLocalSaleStock } from "@/lib/offline-sale";
import { queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";
import { formatUsd } from "@/lib/fx";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const sales = await prisma.sale.findMany({
      include: {
        cashier: { select: { id: true, name: true } },
        paymentMethod: true,
        customer: true,
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonMoney({ sales });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Sale id required" }, { status: 400 });
    }

    const local = readLocalSale(id);
    const mirrored = (
      readSnapshot<{ id: string; items: { productId: string; quantity: number }[] }[]>(
        "sales"
      ) || []
    ).find((sale) => sale.id === id);
    const onThisRegister = Boolean(local || mirrored);
    const pending = local ? local.syncStatus !== "synced" : false;
    let removedOnline = false;

    if (!pending) {
      try {
        await prisma.$transaction(async (tx) => {
          const sale = await tx.sale.findUnique({
            where: { id },
            include: { items: { include: { allocations: true } } },
          });
          if (!sale) throw new Error("NOT_FOUND");

          for (const item of sale.items) {
            const product = await tx.product.findUnique({
              where: { id: item.productId },
            });
            if (product?.trackQty) {
              await restoreSaleItemStock(tx, item, sale.createdAt);
            }
          }

          await tx.sale.delete({ where: { id } });
        });
        removedOnline = true;
      } catch (error) {
        const missing = error instanceof Error && error.message === "NOT_FOUND";
        if (!missing) {
          if (isDbUnavailable(error)) {
            if (local) restoreLocalSaleStock(local.items);
            else if (mirrored) restoreLocalSaleStock(mirrored.items);
            dropLocalSale(id);
            queueOp(`sale:${id}`, "sale.delete", { id });
            void syncPendingSales();
            bustCache("products", "owner-stats");
            notifyOwners({
              title: "Refund",
              body: local?.receiptNumber
                ? `Receipt ${local.receiptNumber} · ${formatUsd(local.total)} was removed`
                : "A sale was removed",
              url: "/sales",
              tag: `refund:${id}:${Date.now()}`,
            });
            return NextResponse.json({ ok: true });
          }
          throw error;
        }
        if (!onThisRegister) {
          return NextResponse.json({ error: "Sale not found" }, { status: 404 });
        }
      }
    }

    if (!removedOnline && !onThisRegister) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }

    if (local) restoreLocalSaleStock(local.items);
    else if (removedOnline && mirrored) restoreLocalSaleStock(mirrored.items);
    dropLocalSale(id);
    bustCache("products", "owner-stats");
    notifyOwners({
      title: "Refund",
      body: local?.receiptNumber
        ? `Receipt ${local.receiptNumber} · ${formatUsd(local.total)} was removed`
        : "A sale was removed",
      url: "/sales",
      tag: `refund:${id}:${Date.now()}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }
    return authErrorResponse(error);
  }
}
