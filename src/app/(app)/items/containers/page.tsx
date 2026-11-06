import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { ContainersList } from "./ContainersList";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { listLocalContainers } from "@/lib/catalog-cache";
import { readSnapshot } from "@/lib/local-db";

export default async function ContainersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  if (readSnapshot("containers")) {
    return <ContainersList initialContainers={listLocalContainers()} />;
  }

  try {
    const containers = await prisma.container.findMany({
      include: {
        stockLots: {
          where: { quantity: { gt: 0 } },
          include: {
            product: {
              select: { id: true, name: true, sku: true, barcode: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <ContainersList
        initialContainers={containers.map((c) => {
          const byProduct = new Map<
            string,
            {
              productId: string;
              name: string;
              sku: string | null;
              barcode: string | null;
              quantity: number;
              cost: number;
              customsDuty: number;
            }
          >();
          for (const lot of c.stockLots) {
            const current = byProduct.get(lot.productId);
            if (current) {
              current.quantity += lot.quantity;
            } else {
              byProduct.set(lot.productId, {
                productId: lot.productId,
                name: lot.product.name,
                sku: lot.product.sku,
                barcode: lot.product.barcode,
                quantity: lot.quantity,
                cost: toNum(lot.cost),
                customsDuty: toNum(lot.customsDuty),
              });
            }
          }
          const items = [...byProduct.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          return {
            id: c.id,
            code: c.code,
            name: c.name,
            note: c.note,
            arrivedAt: c.arrivedAt ? c.arrivedAt.toISOString() : null,
            cost: toNum(c.cost),
            totalDuty: toNum(c.totalDuty),
            itemCount: items.length,
            items,
          };
        })}
      />
    );
  } catch (error) {
    console.error(error);
    return <ContainersList initialContainers={[]} />;
  }
}
