import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { toNum } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import {
  formatLbp,
  formatRate,
  formatUsd,
  payCurrencyLabel,
  toLbp,
  type PayCurrency,
  DEFAULT_USD_TO_LBP,
} from "@/lib/fx";
import { pricingModeLabel } from "@/lib/price-tiers";

type SaleForPrint = {
  id: string;
  receiptNumber: string;
  createdAt: Date;
  subtotal: unknown;
  discount: unknown;
  tax: unknown;
  total: unknown;
  exchangeRate: unknown;
  payCurrency: string | null;
  changeCurrency: string | null;
  amountTendered: unknown;
  tenderedUsd?: unknown;
  tenderedLbp?: unknown;
  changeUsd: unknown;
  changeLbp: unknown;
  pricingMode: string;
  cashier: { name: string };
  paymentMethod: { name: string };
  items: {
    name: string;
    quantity: number;
    unitPrice: unknown;
    lineTotal: unknown;
  }[];
};

export const RECEIPT_LOCATION = "Akbiyeh - Main Road";
export const RECEIPT_PHONE = "81 604 320";

type SettingsForPrint = {
  storeName: string;
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
} | null;

export type ReceiptPrintResult = {
  mode: "printer" | "pdf";
  printer: string;
  pdf?: string | null;
};

export function buildReceiptPayload(
  sale: SaleForPrint,
  settings: SettingsForPrint
) {
  const rate = toNum(sale.exchangeRate) || DEFAULT_USD_TO_LBP;
  const totalUsd = toNum(sale.total);
  const totalLbp = toLbp(totalUsd, rate);
  const payCurrency = (
    sale.payCurrency === "LBP"
      ? "LBP"
      : sale.payCurrency === "MIXED"
        ? "MIXED"
        : "USD"
  ) as PayCurrency;
  const changeCurrency = (
    sale.changeCurrency === "LBP"
      ? "LBP"
      : sale.changeCurrency === "MIXED"
        ? "MIXED"
        : "USD"
  ) as PayCurrency;
  const amountTendered = toNum(sale.amountTendered);
  const tenderedUsd = toNum(sale.tenderedUsd);
  const tenderedLbp = toNum(sale.tenderedLbp);
  const hasTender = amountTendered > 0 || tenderedUsd > 0 || tenderedLbp > 0;
  const pricing = pricingModeLabel(sale.pricingMode);
  const receivedParts = [
    tenderedUsd > 0 ? formatUsd(tenderedUsd) : "",
    tenderedLbp > 0 ? formatLbp(tenderedLbp) : "",
  ].filter(Boolean);
  const amountReceived =
    receivedParts.length > 0
      ? receivedParts.join(" + ")
      : hasTender
        ? payCurrency === "LBP"
          ? formatLbp(amountTendered)
          : formatUsd(amountTendered)
        : "";

  return {
    storeName: settings?.storeName || "VANO",
    location: RECEIPT_LOCATION,
    address:
      settings?.address && settings.address !== RECEIPT_LOCATION
        ? settings.address
        : "",
    phone: settings?.phone?.trim() || RECEIPT_PHONE,
    receiptNumber: sale.receiptNumber,
    date: formatDate(sale.createdAt),
    cashier: sale.cashier.name,
    payment: sale.paymentMethod.name,
    pricing,
    items: sale.items.map((item) => ({
      name: item.name,
      qty: String(item.quantity),
      each: `${formatUsd(item.unitPrice)} each`,
      total: formatUsd(item.lineTotal),
    })),
    subtotal: formatUsd(sale.subtotal),
    discount: toNum(sale.discount) > 0 ? `-${formatUsd(sale.discount)}` : "",
    tax: toNum(sale.tax) > 0 ? formatUsd(sale.tax) : "",
    totalUsd: formatUsd(totalUsd),
    totalLbp: formatLbp(totalLbp),
    rate: `1 $ = ${formatRate(rate)} L.L`,
    paidIn: hasTender ? payCurrencyLabel(payCurrency) : "",
    amountReceived,
    amountReceivedUsd: hasTender && tenderedUsd > 0 ? formatUsd(tenderedUsd) : "",
    amountReceivedLbp: hasTender && tenderedLbp > 0 ? formatLbp(tenderedLbp) : "",
    changeUsd: hasTender ? formatUsd(sale.changeUsd) : "",
    changeLbp: hasTender ? formatLbp(sale.changeLbp) : "",
    changeIn: hasTender ? payCurrencyLabel(changeCurrency) : "",
    footer: settings?.receiptFooter || "Thank you for your purchase!",
  };
}

export function printReceiptWindows(payload: ReturnType<typeof buildReceiptPayload>) {
  const jsonPath = path.join(
    os.tmpdir(),
    `vano-receipt-${payload.receiptNumber}.json`
  );
  const pdfDir = path.join(os.homedir(), "Documents", "VANO Receipts");
  const pdfPath = path.join(pdfDir, `${payload.receiptNumber}.pdf`);
  const scriptPath = path.join(process.cwd(), "scripts", "print-receipt.ps1");

  fs.writeFileSync(jsonPath, JSON.stringify(payload), "utf8");

  const args = [
    "-STA",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-JsonPath",
    jsonPath,
    "-PdfPath",
    pdfPath,
  ];

  return new Promise<ReceiptPrintResult>((resolve, reject) => {
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        fs.unlinkSync(jsonPath);
      } catch {
        // ignore temp cleanup
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Print failed (${code})`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
      try {
        const parsed = JSON.parse(line) as ReceiptPrintResult;
        resolve({
          mode: parsed.mode === "printer" ? "printer" : "pdf",
          printer: parsed.printer,
          pdf: parsed.pdf || (parsed.mode === "pdf" ? pdfPath : null),
        });
      } catch {
        resolve({
          mode: fs.existsSync(pdfPath) ? "pdf" : "printer",
          printer: "default",
          pdf: fs.existsSync(pdfPath) ? pdfPath : null,
        });
      }
    });
  });
}
