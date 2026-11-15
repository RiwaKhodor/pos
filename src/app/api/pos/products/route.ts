import { authErrorResponse, requireAuth } from "@/lib/auth";
import { jsonMoney } from "@/lib/money";
import { isDbUnavailable } from "@/lib/db-unavailable";
import {
  refreshCatalogFromSupabase,
  searchCatalog,
  writeLocalDescriptions,
} from "@/lib/catalog-cache";
import { syncSnapshot } from "@/lib/sync-sales";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().toLowerCase() || "";
    const status = syncSnapshot();
    if (!status.catalogAt) {
      try {
        await refreshCatalogFromSupabase();
      } catch (error) {
        if (!isDbUnavailable(error)) throw error;
      }
    } else {
      try {
        const rows = await prisma.product.findMany({
          select: { id: true, description: true },
        });
        writeLocalDescriptions(rows);
      } catch (error) {
        if (!isDbUnavailable(error)) throw error;
      }
    }
    const products = searchCatalog(q).map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description || "",
      sku: product.sku,
      barcode: product.barcode,
      unit: product.unit,
      price: product.price,
      wholesalePrice: product.wholesalePrice,
      onlinePrice: product.onlinePrice,
      retailPrice: product.retailPrice,
      maxDiscountPercent:
        product.maxDiscountPercent == null
          ? null
          : Number(product.maxDiscountPercent),
      wholesaleMinQty: product.wholesaleMinQty,
      wholesaleMaxQty: product.wholesaleMaxQty,
      stock: product.stock,
      trackQty: product.trackQty,
    }));
    const fresh = syncSnapshot();
    return jsonMoney({
      products,
      stale: fresh.catalogStale,
      offline: fresh.mode === "offline",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
