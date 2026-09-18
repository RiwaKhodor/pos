import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ItemForm } from "../ItemForm";

type Props = {
  searchParams: Promise<{ barcode?: string; containerId?: string }>;
};

export default async function NewItemPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const params = await searchParams;
  const [categories, containers] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.container.findMany({ orderBy: { code: "asc" } }),
  ]);

  return (
    <ItemForm
      mode="create"
      categories={categories}
      containers={containers.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
      }))}
      initial={{
        ...(params.barcode ? { barcode: params.barcode } : {}),
        ...(params.containerId ? { containerId: params.containerId } : {}),
      }}
    />
  );
}
