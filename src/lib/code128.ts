// Code 128, set B. Each value is bar/space widths. Stop has 7 widths.
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;

function encodeSetB(text: string) {
  const codes = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 32;
    if (code < 0 || code > 95) {
      throw new Error(`Cannot print this character in a barcode: ${ch}`);
    }
    codes.push(code);
  }
  return codes;
}

// Digit pairs are one symbol each, so a numeric code is shorter and can be printed wider.
function encodeSetC(text: string) {
  const codes: number[] = [];
  let i = 0;
  if (text.length % 2 === 1) {
    if (text.length === 1) return encodeSetB(text);
    codes.push(START_C);
    while (i + 1 < text.length) {
      codes.push(Number(text.slice(i, i + 2)));
      i += 2;
    }
    codes.push(CODE_B);
    codes.push(text.charCodeAt(i) - 32);
    return codes;
  }
  codes.push(START_C);
  while (i < text.length) {
    codes.push(Number(text.slice(i, i + 2)));
    i += 2;
  }
  return codes;
}

export function code128Bars(value: string, quiet = 10) {
  const text = value.trim();
  if (!text) return "";
  const codes = /^\d+$/.test(text) ? encodeSetC(text) : encodeSetB(text);
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(106);

  const pad = quiet > 0 ? "0".repeat(quiet) : "";
  let modules = pad;
  for (const code of codes) {
    const pattern = PATTERNS[code];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      modules += (i % 2 === 0 ? "1" : "0").repeat(width);
    }
  }
  return modules + pad;
}
