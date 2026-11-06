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
