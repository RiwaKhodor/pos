import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { ItemsList } from "./ItemsList";
import { getCachedItems } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import {
  listLocalItems,
  refreshCatalogFromSupabase,
  writeLocalDescriptions,
} from "@/lib/catalog-cache";
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
        description: true,
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
          description: item.description || "",
        }))}
      />
    );
  }

  const localItems = listLocalItems();
  let initialItems = localItems;
  try {
    await refreshCatalogFromSupabase();
    const fromSupabase = await prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        createdById: true,
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
        description: true,
        category: { select: { name: true } },
        container: { select: { code: true, name: true } },
      },
    });
    writeLocalDescriptions(fromSupabase);
    const localById = new Map(listLocalItems().map((item) => [item.id, item]));
    initialItems = fromSupabase.map((item) => {
      const local = localById.get(item.id);
      return {
        id: item.id,
        createdById: item.createdById || local?.createdById || null,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        price: toNum(item.price),
        wholesalePrice: toNum(item.wholesalePrice),
        onlinePrice: toNum(item.onlinePrice),
        retailPrice: toNum(item.retailPrice),
        cost: local?.cost ?? toNum(item.cost),
        customsDuty: local?.customsDuty ?? toNum(item.customsDuty),
        stock: local?.stock ?? item.stock,
        lowStockAt: item.lowStockAt,
        active: item.active,
        showInPos: item.showInPos,
        categoryName: item.category?.name || local?.categoryName || null,
        containerCode:
          local?.containerCode ||
          item.container?.name ||
          item.container?.code ||
          null,
        description: item.description || local?.description || "",
      };
    });
  } catch (error) {
    console.error(error);
    if (localItems.length === 0) {
      try {
        initialItems = await getCachedItems();
      } catch (fallback) {
        console.error(fallback);
      }
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
