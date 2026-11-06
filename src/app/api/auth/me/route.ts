import { authErrorResponse, requireAuth } from "@/lib/auth";
import { getStoreSettings } from "@/lib/store";
import { jsonMoney } from "@/lib/money";
import { DEFAULT_USD_TO_LBP } from "@/lib/fx";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readCachedSettings } from "@/lib/catalog-cache";
import { percentsFromSettings } from "@/lib/price-tiers";

export async function GET() {
  try {
    const user = await requireAuth();
    let settings: {
      storeName: string;
      currency: string;
      usdToLbpRate: number;
      taxRate: number;
    };
    try {
      settings = await getStoreSettings();
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      const cached = readCachedSettings();
      settings = {
        storeName: cached?.storeName || "VANO",
        currency: cached?.currency || "USD",
        usdToLbpRate: cached?.usdToLbpRate || DEFAULT_USD_TO_LBP,
        taxRate: cached?.taxRate || 0,
      };
    }
    let cached: ReturnType<typeof readCachedSettings> = null;
    try {
      cached = readCachedSettings();
    } catch {
      cached = null;
    }
    return jsonMoney({
      user,
      storeName: settings.storeName,
      currency: settings.currency,
      usdToLbpRate: cached?.usdToLbpRate || settings.usdToLbpRate,
      taxRate: cached?.taxRate ?? settings.taxRate,
      priceTiers: percentsFromSettings(cached),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
