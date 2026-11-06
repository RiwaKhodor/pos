import { toNum } from "./money";

export type PayCurrency = "USD" | "LBP";

export const DEFAULT_USD_TO_LBP = 89500;

export function roundMoney(n: number) {
  const value = Number.isFinite(n) ? n : 0;
  return Number(value.toFixed(2));
}

export function toLbp(usd: number, rate: number) {
  return roundMoney(usd * Math.max(rate, 0));
}

export function toUsd(lbp: number, rate: number) {
  if (!(rate > 0)) return 0;
  return roundMoney(lbp / rate);
}

export function formatUsd(amount: Parameters<typeof toNum>[0]) {
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(toNum(amount)))}`;
}

function groupDigits(value: number) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatLbp(amount: Parameters<typeof toNum>[0]) {
  return `${groupDigits(toNum(amount))} L.L`;
}

export function formatRate(rate: number) {
  return groupDigits(rate);
}

export function payCurrencyLabel(code: PayCurrency) {
  return code === "LBP" ? "L.L" : "Dollars";
}

export function computeTenderChange(opts: {
  totalUsd: number;
  rate: number;
  payCurrency: PayCurrency;
  tendered: number;
}) {
  const rate = opts.rate > 0 ? opts.rate : DEFAULT_USD_TO_LBP;
  const dueUsd = roundMoney(opts.totalUsd);
  const dueLbp = toLbp(dueUsd, rate);
  const tendered = roundMoney(opts.tendered);

  if (opts.payCurrency === "LBP") {
    const changeLbp = roundMoney(tendered - dueLbp);
    return {
      rate,
      dueUsd,
      dueLbp,
      tendered,
      changeUsd: toUsd(changeLbp, rate),
      changeLbp,
    };
  }

  const changeUsd = roundMoney(tendered - dueUsd);
  return {
    rate,
    dueUsd,
    dueLbp,
    tendered,
    changeUsd,
    changeLbp: toLbp(changeUsd, rate),
  };
}
