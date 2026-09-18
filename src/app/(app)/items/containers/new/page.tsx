import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ContainerForm } from "../ContainerForm";

export default async function NewContainerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const products = await prisma.product.findMany({
    include: { container: { select: { code: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <ContainerForm
      mode="create"
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        containerId: p.containerId,
        containerCode: p.container?.code || null,
      }))}
    />
  );
}
