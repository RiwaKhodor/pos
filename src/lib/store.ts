import { unstable_cache, revalidateTag } from "next/cache";
import { cache } from "react";
import { prisma } from "./prisma";
import { toNum } from "./money";
import { DEFAULT_USD_TO_LBP } from "./fx";

const STORE_SETTINGS_TAG = "store-settings";

export type StoreSettingsSnapshot = {
  storeName: string;
  currency: string;
  usdToLbpRate: number;
  taxRate: number;
  discAbove500: number;
  discAbove1000: number;
  discAbove3000: number;
  discAbove5000: number;
  discAbove7000: number;
  discAbove10000: number;
};

const fetchStoreSettings = unstable_cache(
  async (): Promise<StoreSettingsSnapshot> => {
    const settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    return {
      storeName: settings?.storeName || "VANO",
      currency: settings?.currency || "USD",
      usdToLbpRate: toNum(settings?.usdToLbpRate ?? DEFAULT_USD_TO_LBP) || DEFAULT_USD_TO_LBP,
      taxRate: toNum(settings?.taxRate ?? 0),
      discAbove500: toNum(settings?.discAbove500 ?? 0),
      discAbove1000: toNum(settings?.discAbove1000 ?? 0),
      discAbove3000: toNum(settings?.discAbove3000 ?? 0),
      discAbove5000: toNum(settings?.discAbove5000 ?? 0),
      discAbove7000: toNum(settings?.discAbove7000 ?? 0),
      discAbove10000: toNum(settings?.discAbove10000 ?? 0),
    };
  },
  ["store-settings-v4"],
  { revalidate: 60, tags: [STORE_SETTINGS_TAG] }
);

/** Deduped per request; cached across requests for 60s. */
export const getStoreSettings = cache(async () => fetchStoreSettings());

export const getStoreName = cache(async () => {
  const s = await getStoreSettings();
  return s.storeName;
});

export function invalidateStoreNameCache() {
  revalidateTag(STORE_SETTINGS_TAG, "max");
}
