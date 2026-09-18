import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { ContainerCustomsForm } from "./ContainerCustomsForm";

type Props = {
  searchParams: Promise<{ containerId?: string }>;
};

export default async function ContainerCustomsPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const params = await searchParams;

  const [products, containers] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        cost: true,
        customsDuty: true,
        stock: true,
        containerId: true,
      },
    }),
    prisma.container.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, totalDuty: true },
    }),
  ]);

  return (
    <ContainerCustomsForm
      products={products.map((p) => ({
        ...p,
        cost: toNum(p.cost),
        customsDuty: toNum(p.customsDuty),
      }))}
      containers={containers.map((c) => ({
        ...c,
        totalDuty: toNum(c.totalDuty),
      }))}
      initialContainerId={params.containerId}
    />
  );
}
