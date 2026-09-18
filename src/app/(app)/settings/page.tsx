import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  let settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
  });
  if (!settings) {
    settings = await prisma.storeSettings.create({ data: { id: "default" } });
  }

  return (
    <SettingsForm
      settings={{
        storeName: settings.storeName,
        currency: settings.currency,
        taxRate: toNum(settings.taxRate),
        receiptFooter: settings.receiptFooter,
        volumeDisc100: toNum(settings.volumeDisc100),
        volumeDisc200: toNum(settings.volumeDisc200),
        volumeDisc300: toNum(settings.volumeDisc300),
      }}
    />
  );
}
