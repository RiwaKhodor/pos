export const VOLUME_TIERS = [
  { mode: "ABOVE_10000", min: 10000, label: "Above $10,000" },
  { mode: "ABOVE_7000", min: 7000, label: "Above $7,000" },
  { mode: "ABOVE_5000", min: 5000, label: "Above $5,000" },
  { mode: "ABOVE_3000", min: 3000, label: "Above $3,000" },
  { mode: "ABOVE_1000", min: 1000, label: "Above $1,000" },
  { mode: "ABOVE_500", min: 500, label: "Above $500" },
] as const;

export type VolumeMode = (typeof VOLUME_TIERS)[number]["mode"];
export type PricingMode =
  | "REGULAR"
  | "WHOLESALE"
  | "WHOLESALE_PCT"
  | "ONLINE"
  | "RETAIL"
  | VolumeMode;

export type TierPercents = Record<VolumeMode, number>;

export function percentsFromSettings(settings: {
  discAbove500?: number;
  discAbove1000?: number;
  discAbove3000?: number;
  discAbove5000?: number;
  discAbove7000?: number;
  discAbove10000?: number;
} | null | undefined): TierPercents {
  return {
    ABOVE_500: settings?.discAbove500 || 0,
    ABOVE_1000: settings?.discAbove1000 || 0,
    ABOVE_3000: settings?.discAbove3000 || 0,
    ABOVE_5000: settings?.discAbove5000 || 0,
    ABOVE_7000: settings?.discAbove7000 || 0,
    ABOVE_10000: settings?.discAbove10000 || 0,
  };
}

export function normalizePricingMode(value: unknown): PricingMode {
  const mode = String(value || "REGULAR").toUpperCase();
  if (
    mode === "WHOLESALE" ||
    mode === "WHOLESALE_PCT" ||
    mode === "ONLINE" ||
    mode === "RETAIL" ||
    VOLUME_TIERS.some((tier) => tier.mode === mode)
  ) {
    return mode as PricingMode;
  }
  return "REGULAR";
}

export function tierPercent(mode: string, percents: TierPercents) {
  if (mode in percents) return Math.min(100, Math.max(0, percents[mode as VolumeMode] || 0));
  return 0;
}

/** Blank means no cap. A number, including 0, is the most this item can be reduced. */
export function parseMaxDiscount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

export function cappedLinePercent(
  tierPct: number,
  maxDiscount: number | null | undefined
) {
  const tier = Math.min(100, Math.max(0, tierPct || 0));
  if (!(tier > 0)) return 0;
  if (maxDiscount == null || !Number.isFinite(maxDiscount)) return tier;
  return Math.min(tier, Math.max(0, maxDiscount));
}

export function discountForLines(
  lines: { amount: number; maxDiscountPercent?: unknown }[],
  tierPct: number
) {
  let discount = 0;
  let capped = false;
  for (const line of lines) {
    const cap = parseMaxDiscount(line.maxDiscountPercent);
    const pct = cappedLinePercent(tierPct, cap);
    if (cap != null && pct + 0.0001 < tierPct) capped = true;
    discount += (line.amount * pct) / 100;
  }
  return { discount: Number(discount.toFixed(2)), capped };
}

/** Highest configured discount whose receipt total (before discount) is reached. */
export function suggestPriceMode(subtotal: number, percents: TierPercents): PricingMode {
  for (const tier of VOLUME_TIERS) {
    if (subtotal + 0.001 >= tier.min && (percents[tier.mode] || 0) > 0) {
      return tier.mode;
    }
  }
  return "REGULAR";
}

export function unitPriceFor(
  mode: string,
  prices: {
    price: number;
    wholesalePrice?: number;
    onlinePrice?: number;
    retailPrice?: number;
  }
) {
  if (mode === "WHOLESALE" && (prices.wholesalePrice || 0) > 0) {
    return prices.wholesalePrice || 0;
  }
  if (mode === "ONLINE" && (prices.onlinePrice || 0) > 0) {
    return prices.onlinePrice || 0;
  }
  if (mode === "RETAIL" && (prices.retailPrice || 0) > 0) {
    return prices.retailPrice || 0;
  }
  return prices.price;
}

export function cartLineUnitPrice(
  line: {
    price: number;
    wholesalePrice?: number;
    onlinePrice?: number;
    retailPrice?: number;
    useFixedWholesale?: boolean;
  },
  mode: string
) {
  if (line.useFixedWholesale && (line.wholesalePrice || 0) > 0) {
    return line.wholesalePrice || 0;
  }
  return unitPriceFor(mode === "WHOLESALE" ? "REGULAR" : mode, line);
}

export function volumePercentForAmount(subtotal: number, percents: TierPercents) {
  return tierPercent(suggestPriceMode(subtotal, percents), percents);
}

export function pricingModeLabel(mode: string, percents?: TierPercents) {
  if (mode === "WHOLESALE") return "Wholesale (item prices)";
  if (mode === "WHOLESALE_PCT") return "Wholesale (% off receipt)";
  if (mode === "ONLINE") return "Online";
  if (mode === "RETAIL") return "Retail";
  const tier = VOLUME_TIERS.find((row) => row.mode === mode);
  if (tier) {
    const pct = percents ? tierPercent(tier.mode, percents) : 0;
    return pct > 0 ? `${tier.label} (${pct}% off)` : tier.label;
  }
  return "Regular";
}
