import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { clearEnglishDescription } from "@/lib/product-lookup";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { mirrorProductRecord, refreshCatalogFromSupabase } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = (await request.json().catch(() => ({}))) as {
      skipIds?: string[];
    };
    const skipIds = Array.isArray(body.skipIds)
      ? body.skipIds.map(String).filter(Boolean).slice(0, 4000)
      : [];

    const emptyWhere = {
      OR: [{ description: null }, { description: "" }],
    };

    const products = await prisma.product.findMany({
      where: skipIds.length
        ? { AND: [emptyWhere, { id: { notIn: skipIds } }] }
        : emptyWhere,
      select: { id: true, name: true, barcode: true },
      orderBy: { name: "asc" },
      take: 80,
    });

    const attempted: string[] = [];
    let filled = 0;

    for (const product of products) {
      attempted.push(product.id);
      const description = clearEnglishDescription(product.name || "");
      if (!description) continue;
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { description },
        include: { category: true },
      });
      mirrorProductRecord(updated);
      filled += 1;
    }

    const remaining = await prisma.product.count({
      where: {
        AND: [
          emptyWhere,
          { id: { notIn: [...skipIds, ...attempted] } },
        ],
      },
    });

    if (filled) {
      bustCache("products");
      try {
        await refreshCatalogFromSupabase();
      } catch {
        /* local cache can catch up on next sync */
      }
    }

    return NextResponse.json({
      filled,
      attempted: attempted.length,
      remaining,
      skipIds: [...skipIds, ...attempted],
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return NextResponse.json({
        filled: 0,
        attempted: 0,
        remaining: 0,
        skipIds: [],
      });
    }
    return authErrorResponse(error);
  }
}
