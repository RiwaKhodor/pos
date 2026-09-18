import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { InventoryManager } from "./InventoryManager";

export default async function InventoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const products = await prisma.product.findMany({
    where: { active: true },
    include: { category: true },
    orderBy: { stock: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Update stock levels and watch low-stock items"
      />
      <InventoryManager
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          stock: p.stock,
          lowStockAt: p.lowStockAt,
          categoryName: p.category?.name || null,
        }))}
      />
    </div>
  );
}
