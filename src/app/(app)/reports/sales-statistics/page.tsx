import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { SalesStatisticsReport } from "./SalesStatisticsReport";

export default async function SalesStatisticsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
  });

  return <SalesStatisticsReport currency={settings?.currency || "USD"} />;
}
