import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";
import { bustCache } from "@/lib/data-cache";
import { upsertLocalExpense } from "@/lib/catalog-cache";
import { expenseDateFromInput } from "@/lib/expenses";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dropOp, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";
import { readSnapshot } from "@/lib/local-db";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    try {
      const expenses = await prisma.expense.findMany({
        orderBy: { date: "desc" },
      });
      return jsonMoney({ expenses });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      return jsonMoney({ expenses: readSnapshot("expenses") || [] });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const amount = Number(body.amount);
    const note = String(body.note || "").trim();
    if (Number.isNaN(amount) || amount <= 0 || !note) {
      return NextResponse.json(
        { error: "Valid amount and note are required" },
        { status: 400 }
      );
    }
    const date = expenseDateFromInput(body.date);
    const expense = {
      id: crypto.randomUUID(),
      amount,
      note,
      date: date.toISOString(),
    };
    upsertLocalExpense(expense);
    try {
      await prisma.expense.create({
        data: { id: expense.id, amount, note, date },
      });
      dropOp(`expense:${expense.id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`expense:${expense.id}`, "expense.upsert", {
        ...expense,
        pendingCreate: true,
      });
    }
    void syncPendingSales();
    bustCache("expenses", "owner-stats");
    notifyOwners({
      title: "Expense added",
      body: `${note} · $${amount.toFixed(2)}`,
      url: "/reports/profit-loss",
      tag: `expense:${expense.id}`,
    });
    return jsonMoney({ expense }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
