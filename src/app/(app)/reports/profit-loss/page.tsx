import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { ProfitLossReport } from "./ProfitLossReport";
import { readCachedSettings } from "@/lib/catalog-cache";
import { isOwnerWeb } from "@/lib/host";
import { isDbUnavailable } from "@/lib/db-unavailable";

export default async function ProfitLossPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const cached = isOwnerWeb() ? null : readCachedSettings();
  let currency = cached?.currency || "USD";
  let usdToLbpRate = cached?.usdToLbpRate || 89500;
  if (!cached) {
    try {
      const settings = await prisma.storeSettings.findUnique({
        where: { id: "default" },
      });
      currency = settings?.currency || "USD";
      usdToLbpRate = Number(settings?.usdToLbpRate || 89500);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <ProfitLossReport currency={currency} usdToLbpRate={usdToLbpRate} />
  );
}
