import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCachedStoreSettings } from "@/lib/data-cache";
import { Role } from "@/lib/roles";
import { SettingsForm } from "./SettingsForm";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readCachedSettings } from "@/lib/catalog-cache";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const cached = readCachedSettings();
  let settings = cached
    ? {
        storeName: cached.storeName,
        usdToLbpRate: cached.usdToLbpRate,
        taxRate: cached.taxRate,
        phone: cached.phone,
        receiptFooter: cached.receiptFooter,
        discAbove500: cached.discAbove500,
        discAbove1000: cached.discAbove1000,
        discAbove3000: cached.discAbove3000,
        discAbove5000: cached.discAbove5000,
        discAbove7000: cached.discAbove7000,
        discAbove10000: cached.discAbove10000,
      }
    : null;
  if (!settings) {
    try {
      settings = await getCachedStoreSettings();
    } catch (error) {
      console.error(error);
      settings = {
        storeName: "VANO",
        usdToLbpRate: 89500,
        taxRate: 0,
        phone: "81 604 320",
        receiptFooter: null,
        discAbove500: 0,
        discAbove1000: 0,
        discAbove3000: 0,
        discAbove5000: 0,
        discAbove7000: 0,
        discAbove10000: 0,
      };
    }
  }

  return <SettingsForm settings={settings} />;
}
