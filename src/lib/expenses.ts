import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { readSnapshot } from "@/lib/local-db";

/** The calendar day a person picked, at local noon, so it stays on that day. */
export function expenseDateFromInput(value: unknown) {
  if (value == null || value === "") return new Date();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function momentOnItsDay(value: string | Date) {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) || /^\d{4}-\d{2}-\d{2}T00:00:00/.test(iso)) {
    const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  return new Date(iso);
}

export function expenseInRange(value: string | Date, start: Date, end: Date) {
  const at = momentOnItsDay(value);
  if (Number.isNaN(at.getTime())) return false;
  return at >= start && at <= end;
}

export function sumSnapshotExpenses(start: Date, end: Date) {
  const rows =
    readSnapshot<{ amount: unknown; date: string }[]>("expenses") || [];
  return rows.reduce((sum, row) => {
    if (!expenseInRange(row.date, start, end)) return sum;
    return sum + toNum(row.amount);
  }, 0);
}

/** Database total when online. The copy on this computer is used if that fails. */
export async function sumExpenses(start: Date, end: Date) {
  try {
    const rows = await prisma.expense.findMany({
      where: {
        date: {
          gte: new Date(start.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(end.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: { amount: true, date: true },
    });
    return rows.reduce((sum, row) => {
      if (!expenseInRange(row.date, start, end)) return sum;
      return sum + toNum(row.amount);
    }, 0);
  } catch (error) {
    console.error(error);
    return sumSnapshotExpenses(start, end);
  }
}
