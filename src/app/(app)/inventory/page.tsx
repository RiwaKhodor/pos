import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { InventoryManager } from "./InventoryManager";
import { getCachedInventory } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalItems } from "@/lib/catalog-cache";

export default async function InventoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const localItems = listLocalItems()
    .filter((item) => item.active)
    .map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      stock: item.stock,
      lowStockAt: item.lowStockAt,
      categoryName: item.categoryName,
      containerName: item.containerCode,
    }));
  let products: typeof localItems = localItems;
  if (localItems.length === 0) {
    try {
      products = (await getCachedInventory()).map((item) => ({
        ...item,
        containerName: null,
      }));
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stock Track"
        subtitle="Tracked stock and the container each item came from. Open an item to change its name or other details."
      />
      <InventoryManager products={products} />
    </div>
  );
}
