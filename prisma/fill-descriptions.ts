import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function descriptionFromName(name: string) {
  const product = String(name || "").replace(/\s+/g, " ").trim();
  if (!product) return "";
  return `${product} is a shop pack.`;
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { name: "asc" },
  });
  let filled = 0;
  for (const product of products) {
    if (String(product.description || "").trim()) continue;
    const description = descriptionFromName(product.name);
    if (!description) continue;
    await prisma.product.update({
      where: { id: product.id },
      data: { description },
    });
    filled += 1;
  }
  const stillEmpty = await prisma.product.count({
    where: { OR: [{ description: null }, { description: "" }] },
  });
  console.log(
    `Updated ${filled} items in Supabase. Empty left: ${stillEmpty}. Total: ${products.length}.`
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
