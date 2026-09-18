import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

export async function GET(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();

    const products = await prisma.product.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      include: { category: true },
      orderBy: { name: "asc" },
    });

    return jsonMoney({ products });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const price = Number(body.price);
    const cost = Number(body.cost ?? 0);
    const customsDuty = Number(body.customsDuty ?? 0);
    const wholesalePrice = Number(body.wholesalePrice ?? 0);
    const stock = Number(body.stock ?? 0);
    const lowStockAt = Number(body.lowStockAt ?? 5);
    const maxStock = Number(body.maxStock ?? 0);
    const sku = body.sku ? String(body.sku).trim() : null;
    const barcode = body.barcode ? String(body.barcode).trim() : null;
    const unit = body.unit ? String(body.unit).trim() : "Pcs";
    const description = body.description
      ? String(body.description).trim()
      : null;
    const categoryId = body.categoryId || null;
    const containerId = body.containerId || null;

    if (!name || Number.isNaN(price) || price < 0) {
      return NextResponse.json(
        { error: "Valid name and price are required" },
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

    if (barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { barcode },
      });
      if (existingBarcode) {
        return NextResponse.json(
          {
            error: `Barcode "${barcode}" is already used by "${existingBarcode.name}".`,
          },
          { status: 400 }
        );
      }
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        cost: Number.isNaN(cost) ? 0 : cost,
        customsDuty: Number.isNaN(customsDuty) ? 0 : customsDuty,
        wholesalePrice: Number.isNaN(wholesalePrice) ? 0 : wholesalePrice,
        stock: Number.isNaN(stock) ? 0 : stock,
        lowStockAt: Number.isNaN(lowStockAt) ? 5 : lowStockAt,
        maxStock: Number.isNaN(maxStock) ? 0 : maxStock,
        sku,
        barcode,
        unit: unit || "Pcs",
        description,
        categoryId,
        containerId,
        active: body.active !== false,
        showInPos: body.showInPos !== false,
        trackQty: body.trackQty !== false,
      },
      include: { category: true },
    });

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
    return authErrorResponse(error);
  }
}
