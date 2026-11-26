/** Barcode helpers shared by the item form (browser) and the lookup (server). */

/** GS1 check digit for the digits before it (EAN-8, UPC-A, EAN-13, GTIN-14). */
function checkDigit(body: string) {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  return checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Expand an 8-digit UPC-E (small US/Canada packs) to its 12-digit UPC-A, or "" if it is not one. */
export function expandUpcE(code: string) {
  if (!/^[01]\d{7}$/.test(code)) return "";
  const ns = code[0];
  const [d1, d2, d3, d4, d5, m] = code.slice(1, 7);
  let body: string;
  if (m === "0" || m === "1" || m === "2") body = `${ns}${d1}${d2}${m}0000${d3}${d4}${d5}`;
  else if (m === "3") body = `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
  else if (m === "4") body = `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${ns}${d1}${d2}${d3}${d4}${d5}0000${m}`;
  const upcA = `${body}${code[7]}`;
  return isValidGtin(upcA) ? upcA : "";
}

/**
 * Pull the product GTIN out of a GS1 code (GS1-128 / DataMatrix / QR on newer
 * packs), e.g. "(01)04012345678901(17)261231..." or "0104012345678901172612...".
 */
export function gtinFromGs1(raw: string) {
  const text = String(raw || "").replace(/[\u001d\s]/g, "");
  const match = text.match(/^\(01\)(\d{14})/) || text.match(/^01(\d{14})(?:\d|$|\()/);
  if (!match) return "";
  const gtin = match[1];
  if (!isValidGtin(gtin)) return "";
  // GTIN-14 with a leading 0 is the same product as the EAN-13 printed on the pack.
  return gtin.startsWith("0") ? gtin.slice(1) : gtin;
}

/** True once a typed/scanned value is a complete, valid product barcode. */
export function isCompleteBarcode(raw: string) {
  const text = String(raw || "").trim();
  if (gtinFromGs1(text)) return true;
  const digits = text.replace(/\D/g, "");
  if (digits.length !== text.replace(/[\s-]/g, "").length) return false;
  return isValidGtin(digits) || Boolean(expandUpcE(digits));
}
