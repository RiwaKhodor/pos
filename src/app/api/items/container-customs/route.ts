import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";

type LineIn = {
  productId: string;
  quantity: number;
};

/**
 * Allocate a container's total customs duty across items.
 * Default split: by value (cost × qty). Option: by quantity only.
 * Saves per-unit customsDuty on each product.
 */
export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const totalDuty = Number(body.totalDuty);
    const mode = body.mode === "qty" ? "qty" : "value";
    const applyMode = body.applyMode === "add" ? "add" : "replace";
    const lines = (body.lines || []) as LineIn[];

    if (!Number.isFinite(totalDuty) || totalDuty < 0) {
      return Response.json(
        { error: "Valid total customs duty is required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return Response.json(
        { error: "Add at least one item from the container" },
        { status: 400 }
      );
    }

    const normalized = lines.map((l) => ({
      productId: String(l.productId || ""),
      quantity: Math.max(0, Math.floor(Number(l.quantity) || 0)),
    }));

    if (normalized.some((l) => !l.productId || l.quantity < 1)) {
      return Response.json(
        { error: "Each line needs a product and quantity of at least 1" },
        { status: 400 }
      );
    }

    const products = await prisma.product.findMany({
      where: { id: { in: normalized.map((l) => l.productId) } },
    });
    if (products.length !== normalized.length) {
      return Response.json(
        { error: "One or more products were not found" },
        { status: 400 }
      );
    }

    const byId = new Map(products.map((p) => [p.id, p]));

    const weighted = normalized.map((l) => {
      const product = byId.get(l.productId)!;
      const cost = toNum(product.cost);
      const weight =
        mode === "qty"
          ? l.quantity
          : Math.max(cost, 0) * l.quantity || l.quantity;
      return { ...l, product, weight };
    });

    const weightSum = weighted.reduce((s, l) => s + l.weight, 0);
    if (weightSum <= 0) {
      return Response.json(
        { error: "Cannot allocate duty — check costs and quantities" },
        { status: 400 }
      );
    }

    const allocations = weighted.map((l) => {
      const share = (l.weight / weightSum) * totalDuty;
      const perUnit = share / l.quantity;
      const existingDuty = toNum(l.product.customsDuty);
      const nextDuty =
        applyMode === "add"
          ? Number((existingDuty + perUnit).toFixed(4))
          : Number(perUnit.toFixed(4));
      return {
        productId: l.productId,
        name: l.product.name,
        quantity: l.quantity,
        share: Number(share.toFixed(2)),
        perUnit: Number(perUnit.toFixed(4)),
        customsDuty: nextDuty,
        landedCost: Number((toNum(l.product.cost) + nextDuty).toFixed(4)),
      };
    });

    await prisma.$transaction(async (tx) => {
      await Promise.all(
        allocations.map((a) =>
          tx.product.update({
            where: { id: a.productId },
            data: { customsDuty: a.customsDuty },
          })
        )
      );

      const containerId = body.containerId ? String(body.containerId) : null;
      if (containerId) {
        await tx.container.update({
          where: { id: containerId },
          data: { totalDuty },
        });
      }
    });

    return jsonMoney({
      totalDuty,
      mode,
      applyMode,
      allocations,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
