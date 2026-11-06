import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";
import { customsFromContainer } from "@/lib/container-duty";
import { bustCache } from "@/lib/data-cache";
import { upsertLocalContainer } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { lotDb, upsertContainerLot } from "@/lib/stock-lots";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const containers = await prisma.container.findMany({
      include: {
        _count: { select: { products: true } },
        products: {
          select: { id: true, name: true, sku: true, stock: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return jsonMoney({ containers });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const held: {
    code?: string;
    name?: string;
    note?: string | null;
    cost?: number;
    totalDuty?: number;
    arrivedAt?: Date | null;
  } = {};
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const code = String(body.code || "").trim();
    const name = String(body.name || "").trim();
    const note = body.note ? String(body.note).trim() : null;
    const cost = Number(body.cost ?? 0);
    const totalDuty = Number(body.totalDuty ?? 0);
    const arrivedAt = body.arrivedAt
      ? new Date(String(body.arrivedAt))
      : null;
    held.code = code;
    held.name = name;
    held.note = note;
    held.cost = cost;
    held.totalDuty = totalDuty;
    held.arrivedAt = arrivedAt;
    const lines = Array.isArray(body.lines)
      ? (body.lines as {
          productId?: string;
          quantity?: number;
          cost?: number;
          customsDuty?: number;
        }[])
      : [];

    if (!code || !name) {
      return NextResponse.json(
        { error: "Container code and name are required" },
        { status: 400 }
      );
    }

    if (arrivedAt && Number.isNaN(arrivedAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid arrival date" },
        { status: 400 }
      );
    }

    const containerData = {
      code,
      name,
      note,
      cost: Number.isFinite(cost) ? cost : 0,
      totalDuty: Number.isFinite(totalDuty) ? totalDuty : 0,
      arrivedAt,
    };

    if (lines.length === 0) {
      const container = await prisma.container.create({ data: containerData });
      upsertLocalContainer(container);
      bustCache("products");
      notifyOwners({
        title: "Container added",
        body: `${name} (${code})`,
        url: "/items",
        tag: `container:${container.id}:${Date.now()}`,
      });
      return jsonMoney({ container }, { status: 201 });
    }

    const created = await prisma.container.create({ data: containerData });
    const tx = lotDb();
    for (const line of lines) {
      const productId = String(line.productId || "");
      if (!productId) continue;
      await upsertContainerLot(tx, {
        productId,
        containerId: created.id,
        quantity: Number(line.quantity || 0),
        cost: Number(line.cost || 0),
        customsDuty: customsFromContainer(Number(line.cost || 0), {
          cost: Number(containerData.cost || 0),
          totalDuty: Number(containerData.totalDuty || 0),
        }),
        receivedAt: arrivedAt,
      });
    }
    const container = await prisma.container.findUnique({
      where: { id: created.id },
      include: {
        _count: { select: { products: true } },
        products: {
          select: { id: true, name: true, sku: true, stock: true },
          orderBy: { name: "asc" },
        },
      },
    });

    if (container) upsertLocalContainer(container);
    bustCache("products");
    notifyOwners({
      title: "Container added",
      body: `${name} (${code})`,
      url: "/items",
      tag: `container:${created.id}:${Date.now()}`,
    });
    return jsonMoney({ container }, { status: 201 });
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
    if (isDbUnavailable(error) && held.code && held.name) {
      const container = {
        id: crypto.randomUUID(),
        code: held.code,
        name: held.name,
        note: held.note || null,
        cost: Number.isFinite(held.cost) ? held.cost || 0 : 0,
        totalDuty: Number.isFinite(held.totalDuty) ? held.totalDuty || 0 : 0,
        arrivedAt: held.arrivedAt ? held.arrivedAt.toISOString() : null,
        pendingCreate: true,
      };
      upsertLocalContainer(container);
      queueOp(`container:${container.id}`, "container.upsert", container);
      void syncPendingSales();
      notifyOwners({
        title: "Container added",
        body: `${held.name} (${held.code})`,
        url: "/items",
        tag: `container:${container.id}:${Date.now()}`,
      });
      return jsonMoney({ container }, { status: 201 });
    }
    return authErrorResponse(error);
  }
}
