import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ContainerForm } from "../ContainerForm";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";

type Params = { params: Promise<{ id: string }> };

export default async function EditContainerPage({ params }: Params) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const { id } = await params;
  const local = (
    readSnapshot<
      {
        id: string;
        code: string;
        name: string;
        note: string | null;
        arrivedAt: string | null;
        cost: number;
        totalDuty: number;
      }[]
    >("containers") || []
  ).find((container) => container.id === id);

  const container = local
    ? local
    : await (async () => {
        try {
          const remote = await prisma.container.findUnique({ where: { id } });
          if (!remote) return null;
          return {
            id: remote.id,
            code: remote.code,
            name: remote.name,
            note: remote.note,
            arrivedAt: remote.arrivedAt ? remote.arrivedAt.toISOString() : null,
            cost: Number(remote.cost),
            totalDuty: Number(remote.totalDuty),
          };
        } catch (error) {
          console.error(error);
          return null;
        }
      })();
  if (!container) notFound();

  return (
    <ContainerForm
      mode="edit"
      products={[]}
      initial={{
        id: container.id,
        code: container.code,
        name: container.name,
        note: container.note || "",
        arrivedAt: container.arrivedAt
          ? container.arrivedAt.slice(0, 10)
          : "",
        cost: String(container.cost),
        totalDuty: String(container.totalDuty),
      }}
    />
  );
}
