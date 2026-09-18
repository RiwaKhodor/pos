import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

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

    const productIds = Array.isArray(body.productIds)
      ? (body.productIds as string[]).map(String).filter(Boolean)
      : null;

    const container = await prisma.$transaction(async (tx) => {
      await tx.container.update({ where: { id }, data });

      if (productIds) {
        await tx.product.updateMany({
          where: { containerId: id, id: { notIn: productIds } },
          data: { containerId: null },
        });
        if (productIds.length > 0) {
          await tx.product.updateMany({
            where: { id: { in: productIds } },
            data: { containerId: id },
          });
        }
      }

      return tx.container.findUnique({
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
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;

    await prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { containerId: id },
        data: { containerId: null },
      });
      await tx.container.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
