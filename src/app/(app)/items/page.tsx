import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { ItemsList } from "./ItemsList";
import { getCachedItems } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalItems } from "@/lib/catalog-cache";
import { isOwnerWeb } from "@/lib/host";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";

export default async function ItemsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (isOwnerWeb()) {
    if (user.role !== Role.OWNER) redirect("/login");
    const products = await prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        price: true,
        wholesalePrice: true,
        onlinePrice: true,
        retailPrice: true,
        cost: true,
        customsDuty: true,
        stock: true,
        lowStockAt: true,
        active: true,
        showInPos: true,
        category: { select: { name: true } },
        container: { select: { code: true, name: true } },
      },
    });
    return (
      <ItemsList
        viewOnly
        canManage={false}
        initialItems={products.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          unit: item.unit,
          price: toNum(item.price),
          wholesalePrice: toNum(item.wholesalePrice),
          onlinePrice: toNum(item.onlinePrice),
          retailPrice: toNum(item.retailPrice),
          cost: toNum(item.cost),
          customsDuty: toNum(item.customsDuty),
          stock: item.stock,
          lowStockAt: item.lowStockAt,
          active: item.active,
          showInPos: item.showInPos,
          categoryName: item.category?.name || null,
          containerCode: item.container?.name || item.container?.code || null,
        }))}
      />
    );
  }

  const localItems = listLocalItems();
  let initialItems = localItems;
  if (localItems.length === 0) {
    try {
      initialItems = await getCachedItems();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <ItemsList
      initialItems={initialItems}
      canManage={user.role === Role.OWNER}
      viewerId={user.id}
    />
  );
}
