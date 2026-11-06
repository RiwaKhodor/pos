import { readLocalSale } from "../src/lib/offline-sale";

const sale = readLocalSale(process.env.VANO_SALE_ID || "");
if (!sale) {
  console.error("missing sale");
  process.exit(2);
}
console.log(sale.receiptNumber);
