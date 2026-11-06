import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney, toNum } from "@/lib/money";
import { bustCache } from "@/lib/data-cache";
import { forgetLocalContainer, upsertLocalContainer } from "@/lib/catalog-cache";
import { customsFromContainer } from "@/lib/container-duty";
import { lotDb, refreshProductFromLots, upsertContainerLot } from "@/lib/stock-lots";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueDelete } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const container = await prisma.container.findUnique({
      where: { id },
      include: {
        products: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            cost: true,
            customsDuty: true,
            stock: true,
            price: true,
          },
        },
      },
    });
    if (!container) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 });
    }
    return jsonMoney({ container });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.container.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 });
    }

    const data: Prisma.ContainerUpdateInput = {};
    if (body.code !== undefined) data.code = String(body.code).trim();
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.note !== undefined) {
      data.note = body.note ? String(body.note).trim() : null;
    }
    if (body.cost !== undefined) {
      data.cost = Number(body.cost) || 0;
    }
    if (body.totalDuty !== undefined) {
      data.totalDuty = Number(body.totalDuty) || 0;
    }
    if (body.arrivedAt !== undefined) {
      if (!body.arrivedAt) {
        data.arrivedAt = null;
      } else {
        const d = new Date(String(body.arrivedAt));
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "Invalid arrival date" },
            { status: 400 }
          );
        }
        data.arrivedAt = d;
      }
    }

    if (data.code === "" || data.name === "") {
      return NextResponse.json(
        { error: "Container code and name are required" },
        { status: 400 }
      );
    }

    const lines = Array.isArray(body.lines)
      ? (body.lines as {
          productId?: string;
          quantity?: number;
          cost?: number;
          customsDuty?: number;
        }[])
      : null;

    const tx = lotDb();
    const saved = await prisma.container.update({ where: { id }, data });

    if (lines) {
      for (const line of lines) {
        const productId = String(line.productId || "");
        if (!productId) continue;
        await upsertContainerLot(tx, {
          productId,
          containerId: id,
          quantity: Number(line.quantity || 0),
          cost: Number(line.cost || 0),
          customsDuty: customsFromContainer(Number(line.cost || 0), {
            cost: toNum(saved.cost),
            totalDuty: toNum(saved.totalDuty),
          }),
          receivedAt: saved.arrivedAt,
        });
      }
    } else if (body.cost !== undefined || body.totalDuty !== undefined) {
      const rate = {
        cost: toNum(saved.cost),
        totalDuty: toNum(saved.totalDuty),
      };
      const lots = await prisma.stockLot.findMany({
        where: { containerId: id },
      });
      const productIds = new Set<string>();
      for (const lot of lots) {
        await prisma.stockLot.update({
          where: { id: lot.id },
          data: {
            customsDuty: customsFromContainer(toNum(lot.cost), rate),
          },
        });
        productIds.add(lot.productId);
      }
      for (const productId of productIds) {
        await refreshProductFromLots(tx, productId);
      }
    }

    const container = await prisma.container.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock: true,
            cost: true,
            customsDuty: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (container) upsertLocalContainer(container);
    bustCache("products");
    const parts: string[] = [];
    if (data.name !== undefined && String(data.name) !== existing.name) {
      parts.push(`name ${existing.name} → ${saved.name}`);
    }
    if (data.code !== undefined && String(data.code) !== existing.code) {
      parts.push(`code ${existing.code} → ${saved.code}`);
    }
    if (body.cost !== undefined && Number(body.cost) !== Number(existing.cost)) {
      parts.push(`cost ${Number(existing.cost)} → ${Number(saved.cost)}`);
    }
    if (
      body.totalDuty !== undefined &&
      Number(body.totalDuty) !== Number(existing.totalDuty)
    ) {
      parts.push(`duty ${Number(existing.totalDuty)} → ${Number(saved.totalDuty)}`);
    }
    notifyOwners({
      title: "Container updated",
      body:
        parts.length > 0
          ? `${saved.name}: ${parts.join("; ")}`
          : `${saved.name} was updated`,
      url: "/items",
      tag: `container:${id}:${Date.now()}`,
    });
    return jsonMoney({ container });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Container code already exists" },
        { status: 400 }
      );
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  let removed = "A container was removed";
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const existing = await prisma.container
      .findUnique({ where: { id }, select: { name: true, code: true } })
      .catch(() => null);
    if (existing) removed = `${existing.name} (${existing.code})`;

    const tx = lotDb();
    const lots = await prisma.stockLot.findMany({
      where: { containerId: id },
      select: { productId: true },
    });
    await prisma.stockLot.updateMany({
      where: { containerId: id },
      data: { containerId: null },
    });
    try {
      await prisma.container.delete({ where: { id } });
    } catch (error) {
      const missing =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025";
      if (!missing) throw error;
    }
    for (const productId of new Set(lots.map((lot) => lot.productId))) {
      await refreshProductFromLots(tx, productId);
    }

    forgetLocalContainer(id);
    bustCache("products");
    notifyOwners({
      title: "Container removed",
      body: removed,
      url: "/items",
      tag: `container:${id}:${Date.now()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isDbUnavailable(error)) {
      const { id } = await params;
      forgetLocalContainer(id);
      queueDelete(`container:${id}`, "container.delete", { id });
      void syncPendingSales();
      notifyOwners({
        title: "Container removed",
        body: removed,
        url: "/items",
        tag: `container:${id}:${Date.now()}`,
      });
      return NextResponse.json({ ok: true });
    }
    return authErrorResponse(error);
  }
}
