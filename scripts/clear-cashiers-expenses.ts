import { PrismaClient } from "@prisma/client";
import { clearLocalCashiersAndExpenses } from "../src/lib/catalog-cache";

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    throw new Error("No owner account found. Cashiers were not removed.");
  }

  const cashiers = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: { id: true, email: true, name: true },
  });

  if (cashiers.length > 0) {
    const ids = cashiers.map((row) => row.id);
    await prisma.sale.updateMany({
      where: { cashierId: { in: ids } },
      data: { cashierId: owner.id },
    });
    await prisma.product.updateMany({
      where: { createdById: { in: ids } },
      data: { createdById: owner.id },
    });
    await prisma.pushSubscription.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: ids } },
    });
  }

  const expenses = await prisma.expense.deleteMany({});
  try {
    clearLocalCashiersAndExpenses();
  } catch (error) {
    console.error(error);
  }

  console.log(
    `Removed ${cashiers.length} cashier(s) and ${expenses.count} expense(s). Sales stay under ${owner.email}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
