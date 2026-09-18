import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ItemForm } from "../ItemForm";

type Params = { params: Promise<{ id: string }> };

export default async function EditItemPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const { id } = await params;
  const [product, categories, containers] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.container.findMany({ orderBy: { code: "asc" } }),
  ]);

  if (!product) notFound();

  return (
    <ItemForm
      mode="edit"
      categories={categories}
      containers={containers.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
      }))}
      initial={{
        id: product.id,
        name: product.name,
        sku: product.sku || "",
        barcode: product.barcode || "",
        unit: product.unit || "Pcs",
        categoryId: product.categoryId || "",
        containerId: product.containerId || "",
        price: String(product.price),
        cost: String(product.cost),
        customsDuty: String(product.customsDuty),
        wholesalePrice: String(product.wholesalePrice),
        stock: String(product.stock),
        lowStockAt: String(product.lowStockAt),
        maxStock: String(product.maxStock),
        active: product.active,
        showInPos: product.showInPos,
        trackQty: product.trackQty,
        description: product.description || "",
      }}
    />
  );
}
