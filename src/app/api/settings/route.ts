import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    let settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    if (!settings) {
      settings = await prisma.storeSettings.create({
        data: { id: "default" },
      });
    }
    return jsonMoney({ settings });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();

    const settings = await prisma.storeSettings.upsert({
      where: { id: "default" },
      update: {
        storeName: String(body.storeName || "My Store"),
        currency: String(body.currency || "USD"),
        taxRate: Number(body.taxRate ?? 0),
        address: body.address ? String(body.address) : null,
        phone: body.phone ? String(body.phone) : null,
        receiptFooter: body.receiptFooter
          ? String(body.receiptFooter)
          : null,
        volumeDisc100: Number(body.volumeDisc100 ?? 5),
        volumeDisc200: Number(body.volumeDisc200 ?? 10),
        volumeDisc300: Number(body.volumeDisc300 ?? 15),
      },
      create: {
        id: "default",
        storeName: String(body.storeName || "My Store"),
        currency: String(body.currency || "USD"),
        taxRate: Number(body.taxRate ?? 0),
        address: body.address ? String(body.address) : null,
        phone: body.phone ? String(body.phone) : null,
        receiptFooter: body.receiptFooter
          ? String(body.receiptFooter)
          : null,
        volumeDisc100: Number(body.volumeDisc100 ?? 5),
        volumeDisc200: Number(body.volumeDisc200 ?? 10),
        volumeDisc300: Number(body.volumeDisc300 ?? 15),
      },
    });

    return jsonMoney({ settings });
  } catch (error) {
    return authErrorResponse(error);
  }
}
