import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import {
  getCachedCategories,
  getCachedContainerOptions,
} from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readItemEditor } from "@/lib/catalog-cache";
import { readSnapshot } from "@/lib/local-db";
import { prisma } from "@/lib/prisma";
import { CorrectItem } from "../CorrectItem";
import { ItemForm } from "../ItemForm";

type Params = { params: Promise<{ id: string }> };

export default async function EditItemPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const local = readItemEditor(id);
  let product = local
    ? {
        id: local.id,
        createdById: local.createdById,
        name: local.name,
        sku: local.sku,
        barcode: local.barcode,
        unit: local.unit,
        categoryId: local.categoryId,
        containerId: local.containerId,
        price: local.price,
        cost: local.cost,
        customsDuty: local.customsDuty,
        wholesalePrice: local.wholesalePrice,
        onlinePrice: local.onlinePrice,
        retailPrice: local.retailPrice,
        maxDiscountPercent: local.maxDiscountPercent,
        wholesaleMinQty: local.wholesaleMinQty,
        wholesaleMaxQty: local.wholesaleMaxQty,
        stock: local.stock,
        lowStockAt: local.lowStockAt,
        maxStock: local.maxStock,
        active: local.active,
        showInPos: local.showInPos,
        trackQty: local.trackQty,
        description: local.description,
        stockLots: local.lots,
      }
    : null;

  if (!product) {
    try {
      const remote = await prisma.product.findUnique({
        where: { id },
        include: {
          stockLots: { orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] },
        },
      });
      if (remote) {
        product = {
          id: remote.id,
          createdById: remote.createdById,
          name: remote.name,
          sku: remote.sku,
          barcode: remote.barcode,
          unit: remote.unit,
          categoryId: remote.categoryId || "",
          containerId: remote.containerId,
          price: Number(remote.price),
          cost: Number(remote.cost),
          customsDuty: Number(remote.customsDuty),
          wholesalePrice: Number(remote.wholesalePrice),
          onlinePrice: Number(remote.onlinePrice),
          retailPrice: Number(remote.retailPrice),
          maxDiscountPercent:
            remote.maxDiscountPercent == null
              ? null
              : Number(remote.maxDiscountPercent),
          wholesaleMinQty: remote.wholesaleMinQty,
          wholesaleMaxQty: remote.wholesaleMaxQty,
          stock: remote.stock,
          lowStockAt: remote.lowStockAt,
          maxStock: remote.maxStock,
          active: remote.active,
          showInPos: remote.showInPos,
          trackQty: remote.trackQty,
          description: remote.description || "",
          stockLots: remote.stockLots.map((lot) => ({
            id: lot.id,
            containerId: lot.containerId,
            containerCode: null,
            quantity: lot.quantity,
            cost: Number(lot.cost),
            customsDuty: Number(lot.customsDuty),
            receivedAt: lot.receivedAt.toISOString(),
          })),
        };
      }
    } catch (error) {
      console.error(error);
    }
  }

  if (!product) notFound();

  if (user.role !== Role.OWNER) {
    if (product.createdById !== user.id) redirect("/items");
    return (
      <CorrectItem
        item={{
          id: product.id,
          name: product.name,
          price: String(product.price),
          barcode: product.barcode || "",
        }}
      />
    );
  }

  const localCategories = readSnapshot<
    {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      _count: { products: number };
    }[]
  >("categories");
  const localContainers = readSnapshot<
    {
      id: string;
      code: string;
      name: string;
      cost: number;
      totalDuty: number;
    }[]
  >("containers");
  let categories = localCategories || [];
  let containers = localContainers || [];
  if (!localCategories || !localContainers) {
    try {
      const [remoteCategories, remoteContainers] = await Promise.all([
        localCategories ? Promise.resolve(categories) : getCachedCategories(),
        localContainers ? Promise.resolve(containers) : getCachedContainerOptions(),
      ]);
      categories = remoteCategories;
      containers = remoteContainers;
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <ItemForm
      mode="edit"
      categories={categories}
      containers={containers}
      role={Role.OWNER}
      initial={{
        id: product.id,
        name: product.name,
        sku: product.sku || "",
        barcode: product.barcode || "",
        unit: product.unit || "Pcs",
        categoryId: product.categoryId || "",
        containerId: product.containerId || "",
        price: String(product.price),
        onlinePrice: product.onlinePrice ? String(product.onlinePrice) : "",
        retailPrice: product.retailPrice ? String(product.retailPrice) : "",
        maxDiscountPercent:
          product.maxDiscountPercent == null
            ? ""
            : String(product.maxDiscountPercent),
        cost: String(product.cost),
        customsDuty: String(product.customsDuty),
        wholesalePrice: String(product.wholesalePrice || ""),
        wholesaleMinQty: product.wholesaleMinQty
          ? String(product.wholesaleMinQty)
          : "",
        wholesaleMaxQty: String(product.wholesaleMaxQty),
        stock: String(product.stock),
        lowStockAt: product.lowStockAt ? String(product.lowStockAt) : "",
        maxStock: String(product.maxStock),
        active: product.active,
        showInPos: product.showInPos,
        trackQty: product.trackQty,
        description: product.description || "",
      }}
      initialLots={product.stockLots.map((lot) => ({
        id: lot.id,
        containerId: lot.containerId || "",
        quantity: String(lot.quantity),
        cost: String(lot.cost),
        customsDuty: String(lot.customsDuty),
      }))}
    />
  );
}
