import { NextResponse } from "next/server";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { buildReceiptPayload, printReceiptWindows } from "@/lib/receipt-print";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readLocalSale } from "@/lib/offline-sale";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const local = readLocalSale(id);

    if (local) {
      if (user.role !== Role.OWNER && local.cashierId !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const payload = buildReceiptPayload(
        {
          ...local,
          createdAt: new Date(local.createdAt),
          cashier: { name: local.cashierName },
          paymentMethod: { name: local.paymentMethodName },
        },
        {
          storeName: local.storeName,
          address: local.address,
          phone: local.phone,
          receiptFooter: local.receiptFooter,
        }
      );
      const result = await printReceiptWindows(payload);
      return NextResponse.json({ ok: true, ...result });
    }

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, name: true } },
        paymentMethod: true,
        items: true,
      },
    });

    if (!sale) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    }
    if (user.role !== Role.OWNER && sale.cashierId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });

    const payload = buildReceiptPayload(sale, settings);
    const result = await printReceiptWindows(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return NextResponse.json(
        {
          error:
            "Sale is not on this computer and the online database is unreachable.",
        },
        { status: 503 }
      );
    }
    const message = error instanceof Error ? error.message : "Print failed";
    if (message.includes("Unauthorized") || message.includes("Forbidden")) {
      return authErrorResponse(error);
    }
    console.error(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
