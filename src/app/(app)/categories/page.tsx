import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { CategoriesManager } from "./CategoriesManager";
import { getCachedCategories } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";

export default async function CategoriesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const local = readSnapshot<
    {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      _count: { products: number };
    }[]
  >("categories");
  let categories = local || [];
  if (!local) {
    try {
      categories = await getCachedCategories();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div>
      <PageHeader title="Categories" subtitle="Organize your products" />
      <CategoriesManager initialCategories={categories} />
    </div>
  );
}
