import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.price !== undefined) data.price = Number(body.price);
    if (body.cost !== undefined) data.cost = Number(body.cost);
    if (body.customsDuty !== undefined) data.customsDuty = Number(body.customsDuty);
    if (body.wholesalePrice !== undefined) {
      data.wholesalePrice = Number(body.wholesalePrice);
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

    const product = await prisma.product.update({
      where: { id },
      data,
      include: { category: true },
    });

    return jsonMoney({ product });
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
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;

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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
