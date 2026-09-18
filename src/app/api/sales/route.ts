import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

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

    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!sale) throw new Error("NOT_FOUND");

      for (const item of sale.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });
        if (product?.trackQty) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      await tx.sale.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }
    return authErrorResponse(error);
  }
}
