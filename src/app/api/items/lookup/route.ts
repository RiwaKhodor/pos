import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { lookupProduct } from "@/lib/product-lookup";
import { Role } from "@/lib/roles";
import { readCachedSettings } from "@/lib/catalog-cache";
import { prisma } from "@/lib/prisma";
import { toNum } from "@/lib/money";
import { DEFAULT_EUR_TO_USD, eurToUsd } from "@/lib/fx";
import { isDbUnavailable } from "@/lib/db-unavailable";

function shopUsd(eur: number | undefined, rate: number) {
  if (!(eur && eur > 0) || !(rate > 0)) return undefined;
  return eurToUsd(eur, rate);
}

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = (await request.json().catch(() => ({}))) as {
      barcode?: string;
      name?: string;
    };
    const barcode = String(body.barcode || "").trim();
    const name = String(body.name || "").trim();
    if (!barcode && !name) {
      return NextResponse.json({ error: "Scan a barcode or type a name." }, { status: 400 });
    }
    const result = await lookupProduct({ barcode, name });
    let rate = readCachedSettings()?.eurToUsdRate || DEFAULT_EUR_TO_USD;
    try {
      const settings = await prisma.storeSettings.findUnique({
        where: { id: "default" },
      });
      const stored = (settings as { eurToUsdRate?: unknown } | null)?.eurToUsdRate;
      if (stored != null) rate = toNum(stored) || rate;
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
    }
    const priceUsd = shopUsd(result.priceEur, rate);
    return NextResponse.json({
      ...result,
      priceUsd,
      matches: (result.matches || []).map((match) => ({
        ...match,
        priceUsd: shopUsd(match.priceEur, rate),
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
