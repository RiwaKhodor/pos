import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

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
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const code = String(body.code || "").trim();
    const name = String(body.name || "").trim();
    const note = body.note ? String(body.note).trim() : null;
    const totalDuty = Number(body.totalDuty ?? 0);
    const arrivedAt = body.arrivedAt
      ? new Date(String(body.arrivedAt))
      : null;
    const productIds = Array.isArray(body.productIds)
      ? (body.productIds as string[]).map(String).filter(Boolean)
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

    const container = await prisma.$transaction(async (tx) => {
      const created = await tx.container.create({
        data: {
          code,
          name,
          note,
          totalDuty: Number.isFinite(totalDuty) ? totalDuty : 0,
          arrivedAt,
        },
      });

      if (productIds.length > 0) {
        await tx.product.updateMany({
          where: { id: { in: productIds } },
          data: { containerId: created.id },
        });
      }

      return tx.container.findUnique({
        where: { id: created.id },
        include: {
          _count: { select: { products: true } },
          products: {
            select: { id: true, name: true, sku: true, stock: true },
            orderBy: { name: "asc" },
          },
        },
      });
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
    return authErrorResponse(error);
  }
}
