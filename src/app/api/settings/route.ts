import { authErrorResponse, requireRole } from "@/lib/auth";
import { bustCache } from "@/lib/data-cache";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { jsonMoney } from "@/lib/money";
import { invalidateStoreNameCache } from "@/lib/store";
import { setStoreNameCookie } from "@/lib/store-cookie";
import { DEFAULT_USD_TO_LBP } from "@/lib/fx";
import { readCachedSettings, writeCachedSettings } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueOp, dropOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    let settings = await prisma.storeSettings.findUnique({
      where: { id: "default" },
    });
    if (!settings) {
      settings = await prisma.storeSettings.create({
        data: { id: "default" },
      });
    }
    return jsonMoney({
      settings: {
        ...settings,
        addItemPasswordHash: undefined,
      },
    });
  } catch (error) {
    if (!isDbUnavailable(error)) return authErrorResponse(error);
    const cached = readCachedSettings();
    return jsonMoney({ settings: cached });
  }
}

export async function PUT(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();

    const rate = Number(body.usdToLbpRate ?? DEFAULT_USD_TO_LBP);
    const usdToLbpRate =
      Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_TO_LBP;
    const storeName = String(body.storeName || "VANO").trim() || "VANO";
    const percent = (value: unknown) => {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, 100);
    };
    const discounts = {
      discAbove500: percent(body.discAbove500),
      discAbove1000: percent(body.discAbove1000),
      discAbove3000: percent(body.discAbove3000),
      discAbove5000: percent(body.discAbove5000),
      discAbove7000: percent(body.discAbove7000),
      discAbove10000: percent(body.discAbove10000),
    };

    const snapshot = {
      storeName,
      currency: "USD",
      usdToLbpRate,
      taxRate: Number(body.taxRate ?? 0),
      address: body.address ? String(body.address) : null,
      phone: body.phone ? String(body.phone) : null,
      receiptFooter: body.receiptFooter ? String(body.receiptFooter) : null,
      ...discounts,
    };
    writeCachedSettings(snapshot);

    try {
      await prisma.storeSettings.upsert({
        where: { id: "default" },
        update: snapshot,
        create: { id: "default", ...snapshot },
      });
      dropOp("settings:default");
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp("settings:default", "settings", snapshot);
    }
    void syncPendingSales();
    invalidateStoreNameCache();
    bustCache("settings");
    notifyOwners({
      title: "Preferences updated",
      body: `${storeName}: tax ${snapshot.taxRate}% · rate ${usdToLbpRate} · discounts ${discounts.discAbove500}% / ${discounts.discAbove1000}% / ${discounts.discAbove3000}% / ${discounts.discAbove5000}% / ${discounts.discAbove7000}% / ${discounts.discAbove10000}%`,
      url: "/owner",
      tag: `settings:${Date.now()}`,
    });
    const response = jsonMoney({ settings: snapshot });
    setStoreNameCookie(response, snapshot.storeName);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
