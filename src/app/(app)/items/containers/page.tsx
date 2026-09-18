import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { ContainersList } from "./ContainersList";

export default async function ContainersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const containers = await prisma.container.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <ContainersList
      initialContainers={containers.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        note: c.note,
        arrivedAt: c.arrivedAt ? c.arrivedAt.toISOString() : null,
        totalDuty: toNum(c.totalDuty),
        itemCount: c._count.products,
      }))}
    />
  );
}
