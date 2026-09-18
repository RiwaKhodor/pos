import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ContainerForm } from "../ContainerForm";

type Params = { params: Promise<{ id: string }> };

export default async function EditContainerPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const { id } = await params;
  const [container, products] = await Promise.all([
    prisma.container.findUnique({
      where: { id },
      include: { products: { select: { id: true } } },
    }),
    prisma.product.findMany({
      include: { container: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!container) notFound();

  return (
    <ContainerForm
      mode="edit"
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        containerId: p.containerId,
        containerCode: p.container?.code || null,
      }))}
      initial={{
        id: container.id,
        code: container.code,
        name: container.name,
        note: container.note || "",
        arrivedAt: container.arrivedAt
          ? container.arrivedAt.toISOString().slice(0, 10)
          : "",
        totalDuty: String(container.totalDuty),
        productIds: container.products.map((p) => p.id),
      }}
    />
  );
}
