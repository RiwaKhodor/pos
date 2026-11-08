import { toNum } from "./money";

export type PayCurrency = "USD" | "LBP" | "MIXED";

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

export function parseGroupedNumber(raw: string) {
  const cleaned = String(raw || "").replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!cleaned || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatUsdInput(raw: string) {
  const cleaned = String(raw || "").replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const firstDot = cleaned.indexOf(".");
  const intRaw = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const decRaw =
    firstDot === -1 ? "" : cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  const intDigits =
    intRaw.replace(/^0+(?=\d)/, "") ||
    (firstDot === -1 ? "0" : intRaw === "" ? "0" : intRaw);
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (firstDot === -1) return grouped;
  return `${grouped}.${decRaw}`;
}

export function formatIntInput(raw: string) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const trimmed = digits.replace(/^0+(?=\d)/, "") || "0";
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const LBP_STEP = 1000;

export function roundLbp(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) / LBP_STEP) * LBP_STEP;
}

/** Cashier types thousands; we always keep L.L in 1,000s. */
export function parseLbpInput(raw: string) {
  return parseGroupedNumber(raw) * LBP_STEP;
}

export function lbpThousandsInput(amount: number) {
  const thousands = Math.round(Math.max(0, amount) / LBP_STEP);
  return formatIntInput(String(thousands));
}

export function formatUsdGrouped(amount: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

export function formatLbp(amount: Parameters<typeof toNum>[0]) {
  return `${groupDigits(toNum(amount))} L.L`;
}

export function formatRate(rate: number) {
  return groupDigits(rate);
}

export function payCurrencyLabel(code: PayCurrency | string) {
  if (code === "LBP") return "L.L";
  if (code === "MIXED") return "Dollars + L.L";
  return "Dollars";
}

export function tenderPayCurrency(tenderedUsd: number, tenderedLbp: number): PayCurrency {
  const usd = (tenderedUsd || 0) > 0.009;
  const lbp = (tenderedLbp || 0) > 0.009;
  if (usd && lbp) return "MIXED";
  if (lbp && !usd) return "LBP";
  return "USD";
}

export function parsePayCurrency(value: unknown, fallback: PayCurrency = "USD"): PayCurrency {
  const code = String(value || "").toUpperCase();
  if (code === "LBP" || code === "MIXED" || code === "USD") return code;
  return fallback;
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

export function computeMixedTender(opts: {
  totalUsd: number;
  rate: number;
  tenderedUsd: number;
  tenderedLbp: number;
  changeUsd?: number | null;
  changeLbp?: number | null;
}) {
  const rate = opts.rate > 0 ? opts.rate : DEFAULT_USD_TO_LBP;
  const dueUsd = roundMoney(opts.totalUsd);
  const dueLbp = toLbp(dueUsd, rate);
  const tenderedUsd = roundMoney(Math.max(0, opts.tenderedUsd || 0));
  const tenderedLbp = roundMoney(Math.max(0, opts.tenderedLbp || 0));
  const paidUsd = roundMoney(tenderedUsd + toUsd(tenderedLbp, rate));
  const changeDueUsd = roundMoney(paidUsd - dueUsd);
  const enough = paidUsd + 0.001 >= dueUsd;

  if (!(changeDueUsd > 0)) {
    return {
      rate,
      dueUsd,
      dueLbp,
      tenderedUsd,
      tenderedLbp,
      paidUsd,
      changeDueUsd: 0,
      changeUsd: 0,
      changeLbp: 0,
      enough,
    };
  }

  const usdGiven = opts.changeUsd != null && Number.isFinite(opts.changeUsd);
  const lbpGiven = opts.changeLbp != null && Number.isFinite(opts.changeLbp);
  let changeUsd = 0;
  let changeLbp = 0;

  if (!usdGiven && !lbpGiven) {
    changeUsd = changeDueUsd;
    changeLbp = 0;
  } else if (usdGiven && !lbpGiven) {
    changeUsd = roundMoney(Math.min(Math.max(0, opts.changeUsd || 0), changeDueUsd));
    changeLbp = toLbp(roundMoney(changeDueUsd - changeUsd), rate);
  } else if (!usdGiven && lbpGiven) {
    changeLbp = roundMoney(Math.max(0, opts.changeLbp || 0));
    const asUsd = toUsd(changeLbp, rate);
    changeUsd = roundMoney(Math.max(0, changeDueUsd - asUsd));
  } else {
    changeUsd = roundMoney(Math.max(0, opts.changeUsd || 0));
    changeLbp = roundMoney(Math.max(0, opts.changeLbp || 0));
  }

  return {
    rate,
    dueUsd,
    dueLbp,
    tenderedUsd,
    tenderedLbp,
    paidUsd,
    changeDueUsd,
    changeUsd,
    changeLbp,
    enough,
  };
}
