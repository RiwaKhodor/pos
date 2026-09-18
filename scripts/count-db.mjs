import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const counts = {
  users: await p.user.count(),
  products: await p.product.count(),
  settings: await p.storeSettings.count(),
  paymentMethods: await p.paymentMethod.count(),
  categories: await p.category.count(),
};
console.log(JSON.stringify(counts, null, 2));
await p.$disconnect();
