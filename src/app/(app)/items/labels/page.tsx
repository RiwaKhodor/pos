import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCachedItems } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalItems } from "@/lib/catalog-cache";
import { LabelsPrint } from "./LabelsPrint";

export default async function BarcodeLabelsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  let products = listLocalItems();
  if (products.length === 0) {
    try {
      products = await getCachedItems();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <LabelsPrint
      items={products
        .filter((product) => product.active)
        .map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          barcode: product.barcode,
        }))}
    />
  );
}
