import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sample = await prisma.product.findMany({
    select: { name: true, description: true },
    take: 5,
    orderBy: { name: "asc" },
  });
  const withText = await prisma.product.count({
    where: { NOT: [{ description: null }, { description: "" }] },
  });
  console.log(JSON.stringify({ withText, sample }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
