import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { ItemsList } from "./ItemsList";

export default async function ItemsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const products = await prisma.product.findMany({
    include: { category: true, container: true },
    orderBy: { name: "asc" },
  });

  return (
    <ItemsList
      initialItems={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        price: toNum(p.price),
        wholesalePrice: toNum(p.wholesalePrice),
        cost: toNum(p.cost),
        customsDuty: toNum(p.customsDuty),
        stock: p.stock,
        lowStockAt: p.lowStockAt,
        active: p.active,
        showInPos: p.showInPos,
        categoryName: p.category?.name || null,
        containerCode: p.container?.code || null,
      }))}
    />
  );
}
