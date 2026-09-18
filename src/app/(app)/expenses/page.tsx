import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { ExpensesManager } from "./ExpensesManager";

export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const expenses = await prisma.expense.findMany({
    orderBy: { date: "desc" },
  });

  return (
    <ExpensesManager
      expenses={expenses.map((e) => ({
        id: e.id,
        amount: toNum(e.amount),
        note: e.note,
        date: e.date.toISOString(),
      }))}
    />
  );
}
