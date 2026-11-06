import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { forgetLocalExpense } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueDelete } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    try {
      await prisma.expense.delete({ where: { id } });
    } catch (error) {
      const missing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2025";
      if (!missing) {
        if (!isDbUnavailable(error)) throw error;
        queueDelete(`expense:${id}`, "expense.delete", { id });
      }
    }
    forgetLocalExpense(id);
    void syncPendingSales();
    bustCache("expenses", "owner-stats");
    notifyOwners({
      title: "Expense removed",
      body: "An expense was removed from the records.",
      url: "/reports/profit-loss",
      tag: `expense-delete:${id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
