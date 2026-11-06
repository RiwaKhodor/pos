import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const rows = await prisma.$queryRaw<{ feed: unknown }[]>`
      SELECT json_build_object(
        'sales', COALESCE((
          SELECT json_agg(row) FROM (
            SELECT id, "receiptNumber", total, "createdAt"
            FROM "Sale"
            ORDER BY "createdAt" DESC
            LIMIT 8
          ) row
        ), CAST('[]' AS json)),
        'expenses', COALESCE((
          SELECT json_agg(row) FROM (
            SELECT id, note, amount, date
            FROM "Expense"
            ORDER BY date DESC, "createdAt" DESC
            LIMIT 40
          ) row
        ), CAST('[]' AS json)),
        'items', COALESCE((
          SELECT json_agg(row) FROM (
            SELECT id, name, price, stock, "updatedAt"
            FROM "Product"
            ORDER BY "updatedAt" DESC, id
            LIMIT 15
          ) row
        ), CAST('[]' AS json))
      ) AS feed
    `;
    let feed = rows[0]?.feed ?? { sales: [], expenses: [], items: [] };
    if (typeof feed === "string") feed = JSON.parse(feed);
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
