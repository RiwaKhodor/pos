import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ProfitLossReport } from "./ProfitLossReport";

export default async function ProfitLossPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
  });

  return <ProfitLossReport currency={settings?.currency || "USD"} />;
}
