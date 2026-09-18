import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    const expenses = await prisma.expense.findMany({
      orderBy: { date: "desc" },
    });
    return jsonMoney({ expenses });
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
    const date = body.date ? new Date(body.date) : new Date();

    if (Number.isNaN(amount) || amount <= 0 || !note) {
      return NextResponse.json(
        { error: "Valid amount and note are required" },
        { status: 400 }
      );
    }

    const expense = await prisma.expense.create({
      data: { amount, note, date },
    });
    return jsonMoney({ expense }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
