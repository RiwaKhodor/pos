/** Wholesale = Normal × Preferences % ÷ 100. */
export function wholesaleFromPercent(normalPrice: number, ofNormalPercent: number) {
  const pct = Math.min(100, Math.max(0, ofNormalPercent || 0));
  if (!(pct > 0) || !(normalPrice > 0)) return 0;
  return Number(((normalPrice * pct) / 100).toFixed(2));
}

/** Keep a typed wholesale, otherwise fill from Preferences % of Normal. */
export function filledWholesalePrice(
  normalPrice: number,
  givenWholesale: number,
  ofNormalPercent: number
) {
  if (givenWholesale > 0) return givenWholesale;
  return wholesaleFromPercent(normalPrice, ofNormalPercent);
}

/** Item wholesale if set, otherwise Preferences % of Normal. */
export function wholesaleUnitPrice(
  normalPrice: number,
  storedWholesale: number,
  ofNormalPercent: number
) {
  if (storedWholesale > 0) return storedWholesale;
  return wholesaleFromPercent(normalPrice, ofNormalPercent);
}

export function wholesaleQtyError(
  quantity: number,
  opts: { wholesalePrice: number; wholesaleMinQty: number; wholesaleMaxQty: number }
) {
  if (!(opts.wholesalePrice > 0)) return null;
  const qty = Math.floor(quantity);
  const min = Math.max(0, Math.floor(opts.wholesaleMinQty || 0));
  const max = Math.max(0, Math.floor(opts.wholesaleMaxQty || 0));
  if (min > 0 && qty < min) {
    return `Wholesale needs at least ${min} units.`;
  }
  if (max > 0 && qty > max) {
    return `Wholesale cannot exceed ${max} units.`;
  }
  return null;
}

export function clampWholesaleQty(
  wanted: number,
  opts: { wholesaleMinQty: number; wholesaleMaxQty: number; stock?: number }
) {
  const min = Math.max(1, Math.floor(opts.wholesaleMinQty || 1));
  const maxCap = Math.max(0, Math.floor(opts.wholesaleMaxQty || 0));
  let qty = Math.max(min, Math.floor(wanted));
  if (maxCap > 0) qty = Math.min(qty, maxCap);
  if (opts.stock != null && opts.stock >= 0) {
    qty = Math.min(qty, opts.stock);
  }
  return Math.max(0, qty);
}
