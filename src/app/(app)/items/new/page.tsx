import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  getCachedCategories,
  getCachedContainerOptions,
} from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";
import { ItemForm } from "../ItemForm";

type Props = {
  searchParams: Promise<{ barcode?: string; containerId?: string }>;
};

export default async function NewItemPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
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
        localContainers
          ? Promise.resolve(containers)
          : getCachedContainerOptions(),
      ]);
      categories = remoteCategories;
      containers = remoteContainers;
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <ItemForm
      mode="create"
      role={user.role}
      categories={categories}
      containers={containers}
      initial={{
        ...(params.barcode ? { barcode: params.barcode } : {}),
        ...(params.containerId ? { containerId: params.containerId } : {}),
      }}
    />
  );
}
