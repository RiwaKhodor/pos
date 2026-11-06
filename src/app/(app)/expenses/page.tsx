import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { ExpensesManager } from "./ExpensesManager";
import { getCachedExpenses } from "@/lib/data-cache";
import { readSnapshot } from "@/lib/local-db";
import { isOwnerWeb } from "@/lib/host";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/utils";

export default async function ExpensesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  if (isOwnerWeb()) {
    const expenses = await prisma.expense.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const total = expenses.reduce((sum, row) => sum + toNum(row.amount), 0);
    return (
      <div className="desk-panel">
        <div className="mb-1 text-sm font-bold">Expenses</div>
        <p className="mb-3 text-xs text-slate-500">
          {formatMoney(total)} on this list. New expenses are added on the store computer.
        </p>
        <div className="item-cards">
          {expenses.length === 0 ? (
            <p>No expenses yet.</p>
          ) : (
            expenses.map((expense) => (
              <article key={expense.id} className="sale-card">
                <div className="sale-card-top">
                  <strong>{expense.note}</strong>
                  <span>{formatMoney(toNum(expense.amount))}</span>
                </div>
                <div className="sale-card-meta">{formatDate(expense.date)}</div>
              </article>
            ))
          )}
        </div>
      </div>
    );
  }

  const local = readSnapshot<
    { id: string; note: string; amount: number; date: string }[]
  >("expenses");
  let expenses = local || [];
  if (!local) {
    try {
      expenses = await getCachedExpenses();
    } catch (error) {
      console.error(error);
    }
  }

  return <ExpensesManager expenses={expenses} />;
}
