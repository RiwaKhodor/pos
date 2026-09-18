import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

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
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const id = String(body.id || "");
    const stock = Number(body.stock);

    if (!id || Number.isNaN(stock) || stock < 0) {
      return NextResponse.json(
        { error: "Valid product id and stock are required" },
        { status: 400 }
      );
    }

    const product = await prisma.product.update({
      where: { id },
      data: { stock },
      include: { category: true },
    });

    return jsonMoney({ product });
  } catch (error) {
    return authErrorResponse(error);
  }
}
