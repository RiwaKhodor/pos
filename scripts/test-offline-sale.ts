import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vano-offline-"));
process.env.VANO_DATA_DIR = dir;

async function main() {
  const dbMod = await import("../src/lib/local-db");
  const catalog = await import("../src/lib/catalog-cache");
  const sales = await import("../src/lib/offline-sale");

  dbMod.localDb()
    .prepare(
      "INSERT INTO settings_cache (id, json) VALUES ('default', ?)"
    )
    .run(
      JSON.stringify({
        storeName: "VANO",
        currency: "USD",
        usdToLbpRate: 89500,
        taxRate: 0,
        address: null,
        phone: null,
        receiptFooter: null,
      })
    );
  dbMod.localDb()
    .prepare(
      "INSERT INTO payment_methods (id, name, active) VALUES ('cash', 'Cash', 1)"
    )
    .run();

  catalog.saveProduct({
    id: "p1",
    name: "Water",
    sku: "BEV-001",
    barcode: "111",
    unit: "Pcs",
    price: 1.5,
    wholesalePrice: 0,
    onlinePrice: 0,
    retailPrice: 0,
    maxDiscountPercent: null,
    wholesaleMinQty: 0,
    wholesaleMaxQty: 0,
    stock: 5,
    trackQty: true,
    active: true,
    showInPos: true,
    cost: 0.4,
    customsDuty: 0.1,
    containerId: null,
    lots: [
      {
        id: "lot1",
        containerId: null,
        containerCode: null,
        quantity: 5,
        cost: 0.4,
        customsDuty: 0.1,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  const sale = sales.completeSaleLocally({
    items: [{ productId: "p1", quantity: 2 }],
    paymentMethodId: "cash",
    pricingMode: "REGULAR",
    payCurrency: "USD",
    changeCurrency: "USD",
    amountTendered: 5,
    discount: 0,
    cashierId: "cashier",
    cashierName: "Demo",
    ownerDiscount: false,
  });

  if (sale.total !== 3) throw new Error(`expected total 3, got ${sale.total}`);
  const stored = sales.readLocalSale(sale.id);
  if (!stored) throw new Error("sale was not stored");
  const product = catalog.readProduct("p1");
  if (!product || product.stock !== 3) {
    throw new Error(`expected stock 3, got ${product?.stock}`);
  }
  if (product.lots[0]?.quantity !== 3) {
    throw new Error("lot quantity was not reduced");
  }

  let rejected = false;
  try {
    sales.completeSaleLocally({
      items: [{ productId: "p1", quantity: 9 }],
      paymentMethodId: "cash",
      pricingMode: "REGULAR",
      payCurrency: "USD",
      changeCurrency: "USD",
      amountTendered: 20,
      discount: 0,
      cashierId: "cashier",
      cashierName: "Demo",
      ownerDiscount: false,
    });
  } catch (error) {
    rejected = error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK");
  }
  if (!rejected) throw new Error("oversell was allowed");
  if (catalog.readProduct("p1")?.stock !== 3) {
    throw new Error("failed sale changed stock");
  }

  const child = spawnSync(
    "npx",
    ["tsx", "scripts/read-offline-sale.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        VANO_DATA_DIR: dir,
        VANO_SALE_ID: sale.id,
      },
    }
  );
  if (child.status !== 0) {
    throw new Error(child.stderr || child.stdout || "reopen failed");
  }

  const backup = dbMod.backupLocalDb();
  if (!fs.existsSync(backup)) throw new Error("backup missing");
  console.log("offline sale ok", sale.receiptNumber);
  console.log("backup", backup);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
