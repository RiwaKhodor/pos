import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { bustCache } from "@/lib/data-cache";
import { prisma } from "@/lib/prisma";
import { Role } from "@/lib/roles";
import { newStoreBarcode } from "@/lib/store-barcode";
import { localDb } from "@/lib/local-db";

export async function POST() {
  try {
    await requireRole(Role.OWNER);
    const products = await prisma.product.findMany({
      select: { id: true, barcode: true },
      orderBy: { name: "asc" },
    });
    const taken = new Set(
      products.map((p) => p.barcode).filter((code): code is string => Boolean(code))
    );
    const missing = products.filter((p) => !p.barcode);
    const assigned: { id: string; barcode: string }[] = [];

    if (missing.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          for (const product of missing) {
            const barcode = newStoreBarcode(taken);
            assigned.push({ id: product.id, barcode });
            await tx.product.update({
              where: { id: product.id },
              data: { barcode },
            });
          }
        },
        { timeout: 20000 }
      );
      const updateLocal = localDb().prepare(
        "UPDATE catalog_products SET barcode = ? WHERE id = ?"
      );
      for (const item of assigned) updateLocal.run(item.barcode, item.id);
      bustCache("products", "owner-stats");
    }

    return NextResponse.json({ assigned: assigned.length, items: assigned });
  } catch (error) {
    return authErrorResponse(error);
  }
}
