import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("owner123", 10);

  await prisma.user.upsert({
    where: { email: "owner@store.com" },
    update: {},
    create: {
      name: "Store Owner",
      email: "owner@store.com",
      passwordHash,
      role: "OWNER",
      active: true,
    },
  });

  const employeeHash = await bcrypt.hash("employee123", 10);
  await prisma.user.upsert({
    where: { email: "cashier@store.com" },
    update: {},
    create: {
      name: "Demo Cashier",
      email: "cashier@store.com",
      passwordHash: employeeHash,
      role: "EMPLOYEE",
      active: true,
    },
  });

  await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      storeName: "Simple POS Store",
      currency: "USD",
      taxRate: 0,
      address: "123 Main Street",
      phone: "555-0100",
      receiptFooter: "Thank you for your purchase!",
    },
  });

  const methods = ["Cash", "Card", "Mobile Pay"];
  for (const name of methods) {
    await prisma.paymentMethod.upsert({
      where: { name },
      update: {},
      create: { name, active: true },
    });
  }

  const beverages = await prisma.category.upsert({
    where: { name: "Beverages" },
    update: {},
    create: { name: "Beverages" },
  });

  const snacks = await prisma.category.upsert({
    where: { name: "Snacks" },
    update: {},
    create: { name: "Snacks" },
  });

  const products = [
    {
      name: "Bottled Water",
      sku: "BEV-001",
      price: 1.5,
      cost: 0.4,
      stock: 100,
      categoryId: beverages.id,
    },
    {
      name: "Cola Can",
      sku: "BEV-002",
      price: 2.0,
      cost: 0.7,
      stock: 80,
      categoryId: beverages.id,
    },
    {
      name: "Potato Chips",
      sku: "SNK-001",
      price: 2.5,
      cost: 1.0,
      stock: 4,
      lowStockAt: 5,
      categoryId: snacks.id,
    },
    {
      name: "Chocolate Bar",
      sku: "SNK-002",
      price: 1.75,
      cost: 0.6,
      stock: 50,
      categoryId: snacks.id,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: product,
    });
  }

  await prisma.customer.upsert({
    where: { id: "demo-customer" },
    update: {},
    create: {
      id: "demo-customer",
      name: "Walk-in Guest",
      phone: "555-0200",
    },
  });

  console.log("Seed complete.");
  console.log("Owner: owner@store.com / owner123");
  console.log("Employee: cashier@store.com / employee123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
