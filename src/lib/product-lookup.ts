import { searchCatalog } from "@/lib/catalog-cache";
import { localDb } from "@/lib/local-db";
import { roundMoney } from "@/lib/fx";
import { lookupBarcodeOnWeb, type WebProduct } from "@/lib/claude-web-lookup";
import { expandUpcE, gtinFromGs1, isValidGtin } from "@/lib/gtin";

const UA = "VANO-POS/0.1.23 (store product lookup)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CatalogHit = {
  name: string;
  description: string;
  trusted?: boolean;
  priceEur?: number;
};

const OFF_HOSTS = [
  "https://de.openfoodfacts.org",
  "https://de.openproductsfacts.org",
  "https://de.openbeautyfacts.org",
  "https://de.openpetfoodfacts.org",
  "https://world.openfoodfacts.org",
  "https://world.openproductsfacts.org",
  "https://world.openbeautyfacts.org",
  "https://world.openpetfoodfacts.org",
];

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEuroAmount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 100000) {
    return roundMoney(raw);
  }
  const text = String(raw || "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text) return 0;
  const match =
    text.match(
      /(\d{1,5}(?:\.\d{3})*(?:,\d{1,2}|,-)|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)\b/i
    ) ||
    text.match(
      /(?:€|eur)\s*(\d{1,5}(?:\.\d{3})*(?:,\d{1,2}|,-)|\d+(?:[.,]\d{1,2})?)/i
    ) ||
    text.match(/^(\d{1,5}(?:\.\d{3})*),-$/) ||
    (/^\d+(?:[.,]\d{1,2})?$/.test(text) ? text.match(/^(.+)$/) : null);
  const token = (match?.[1] || "").replace(/,-$/, "");
  if (!token) return 0;
  const normalized =
    token.includes(",") && token.includes(".")
      ? token.replace(/\./g, "").replace(",", ".")
      : token.includes(",")
        ? token.replace(",", ".")
        : token;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return 0;
  return roundMoney(n);
}

function euroPricesFromText(raw: string, allowCompare = false) {
  const text = String(raw || "").replace(/\u00a0/g, " ");
  if (!text) return [];
  if (!allowCompare && /idealo|geizhals|preisvergleich|billiger\.de/i.test(text.slice(0, 400))) {
    return [];
  }
  const amounts: number[] = [];
  const piece = [
    ...text.matchAll(
      /(\d{1,5}(?:\.\d{3})*),-(?:\s*€)?[\s\S]{0,48}pro\s+st(?:ü|ue)ck/gi
    ),
  ];
  for (const match of piece) {
    const n = parseEuroAmount(`${match[1]},- €`);
    if (n >= 0.15 && n < 5000) amounts.push(n);
  }
  if (amounts.length) return amounts;
  const hyphen = [...text.matchAll(/(\d{1,5}(?:\.\d{3})*),-\s*€/g)];
  for (const match of hyphen) {
    const n = parseEuroAmount(`${match[1]},- €`);
    if (n >= 0.15 && n < 5000) amounts.push(n);
  }
  const ab = [
    ...text.matchAll(/\bab\s+(\d{1,5}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})\s*€/gi),
  ];
  for (const match of ab) {
    const n = parseEuroAmount(`${match[1]} €`);
    if (n >= 0.15 && n < 5000) amounts.push(n);
  }
  const all = [
    ...text.matchAll(/(\d{1,5}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})\s*€/g),
  ];
  for (const match of all) {
    const start = Math.max(0, (match.index || 0) - 28);
    const around = text.slice(start, (match.index || 0) + match[0].length);
    if (/versand|porto|shipping|zuzüglich|zzgl/i.test(around)) continue;
    const n = parseEuroAmount(`${match[1]} €`);
    if (n >= 0.15 && n < 5000) amounts.push(n);
  }
  return amounts;
}

function pickEuroPrice(amounts: number[]) {
  if (!amounts.length) return 0;
  const sorted = [...amounts].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function euroPriceFromText(raw: string, allowCompare = false) {
  return pickEuroPrice(euroPricesFromText(raw, allowCompare));
}

export function extractProductCode(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const gtin = url.pathname.match(/\/01\/(\d{8,14})/);
      if (gtin) return gtin[1];
    } catch {
      /* ignore */
    }
  }
  const gs1 = gtinFromGs1(text);
  if (gs1) return gs1;
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return text;
}

function barcodeVariants(code: string) {
  const digits = code.replace(/\D/g, "");
  if (!digits) return [];
  const out = new Set<string>([digits]);
  const stripped = digits.replace(/^0+/, "") || digits;
  out.add(stripped);
  if (digits.length === 12) out.add(`0${digits}`);
  if (digits.length === 13 && digits.startsWith("0")) out.add(digits.slice(1));
  if (digits.length === 8) {
    out.add(digits.padStart(12, "0"));
    out.add(digits.padStart(13, "0"));
  }
  out.add(digits.padStart(13, "0"));
  out.add(digits.padStart(14, "0"));
  return [...out];
}

function describeFromParts(parts: Array<unknown>) {
  const unique = [...new Set(parts.map(cleanText).filter(Boolean))];
  return unique.join(". ");
}

function normalizeSize(num: string, unit: string) {
  const n = num.replace(",", ".");
  let u = unit
    .toLowerCase()
    .replace(/\./g, "")
    .replace("milliliter", "ml")
    .replace("litres", "L")
    .replace("litre", "L")
    .replace("liter", "L")
    .replace("grams", "g")
    .replace("gramm", "g")
    .replace("gram", "g")
    .replace("kilogram", "kg")
    .replace("stück", "pcs")
    .replace("stk", "pcs");
  if (u === "l") u = "L";
  if (u === "gr") u = "g";
  if (u === "floz" || u === "fl oz") u = "fl oz";
  return `${n} ${u}`;
}

function formatSize(raw: string) {
  const text = cleanText(raw);
  if (!text) return "";
  const pack = text.match(
    /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(ml|milliliter|l|liter|litre|cl|dl|g|gr|gramm|grams?|kg|kilogram|oz|fl\.?\s*oz|stück|stk\.?|pcs)\b/i
  );
  if (pack) return `${pack[1]} x ${normalizeSize(pack[2], pack[3])}`;
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*(ml|milliliter|l|liter|litre|cl|dl|g|gr|gramm|grams?|kg|kilogram|mg|oz|fl\.?\s*oz|stück|stk\.?|pcs)\b/i
  );
  if (!match) return "";
  return normalizeSize(match[1], match[2]);
}

function extractSize(...texts: Array<unknown>) {
  for (const raw of texts) {
    const text = cleanText(raw);
    if (!text) continue;
    const labeled =
      labeledValue(text, "Size") ||
      labeledValue(text, "Quantity") ||
      labeledValue(text, "Weight") ||
      labeledValue(text, "Volume") ||
      labeledValue(text, "Inhalt") ||
      labeledValue(text, "Menge");
    const size = formatSize(labeled) || formatSize(text);
    if (size) return size;
  }
  return "";
}

function firstBrand(raw: unknown) {
  const text = cleanText(raw).split(/[,;/|]/)[0].trim();
  if (!text || text.length < 2 || text.length > 42) return "";
  if (/^(unknown|n\/a|none|null|brand|marke|hersteller|unbranded)$/i.test(text)) return "";
  if (/\d{8,}/.test(text)) return "";
  return text;
}

function withBrandInName(name: string, brand: string) {
  if (!name || !brand) return name;
  const n = name.toLowerCase().replace(/\s+/g, " ");
  const b = brand.toLowerCase().replace(/\s+/g, " ");
  if (n.includes(b)) return name;
  return `${brand} ${name}`;
}

function withSizeInName(name: string, size: string) {
  if (!name || !size) return name;
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.includes(size.toLowerCase().replace(/\s+/g, ""))) return name;
  if (extractSize(name)) return name;
  return `${name} ${size}`;
}

function englishProductName(name: string) {
  let text = cleanText(name).replace(/_/g, " ");
  text = text.replace(/\(\s*(dm|rossmann|müller|mueller|aldi|lidl|obi|hornbach|bauhaus|primark|action)\s*\)/gi, "");
  const swaps: Array<[RegExp, string]> = [
    [/\bnatürliches mineralwasser\b/gi, "Natural Mineral Water"],
    [/\bmineralwasser\b/gi, "Mineral Water"],
    [/\bmit wenig kohlensäure\b/gi, "lightly carbonated"],
    [/\bwenig kohlensäure\b/gi, "lightly carbonated"],
    [/\bmit kohlensäure versetzt\b/gi, "carbonated"],
    [/\bohne kohlensäure\b/gi, "still"],
    [/\bkohlensäurearm\b/gi, "lightly carbonated"],
    [/\bkohlensäure\b/gi, "carbonated"],
    [/\bhei(?:ss|ß)luftfritteuse\b/gi, "Air Fryer"],
    [/\bhei(?:ss|ß)luft[- ]?fritteuse\b/gi, "Air Fryer"],
    [/\bfritteuse\b/gi, "Air Fryer"],
    [/\bmłynek elektryczny\b/gi, "Coffee Grinder"],
    [/\belektrische kaffeemühle\b/gi, "Coffee Grinder"],
    [/\bkaffeemühle\b/gi, "Coffee Grinder"],
    [/\bkaffeemaschine\b/gi, "Coffee Machine"],
    [/\bwasserkocher\b/gi, "Kettle"],
    [/\bedelstahl\b/gi, "Stainless Steel"],
    [/\bschwarz\b/gi, "Black"],
    [/\bczarny\b/gi, "Black"],
    [/\bwei(?:ss|ß)\b/gi, "White"],
    [/\bsilber\b/gi, "Silver"],
    [/\belektrische[rsn]?\b/gi, "Electric"],
    [/\b(\d+)\s*watt\b/gi, "$1 Watts"],
    [/\bgel[\s-]*(da[\s-]*)?bagno\b/gi, "Shower Gel"],
    [/\bgel[\s-]*ba[nñ]o\b/gi, "Shower Gel"],
    [/\bgel[\s-]*de[\s-]*banho\b/gi, "Shower Gel"],
    [/\bgel[\s-]*banho\b/gi, "Shower Gel"],
    [/\bdoccia[\s-]*schiuma\b/gi, "Shower Gel"],
    [/\bdocciaschiuma\b/gi, "Shower Gel"],
    [/\bduschgel\b/gi, "Shower Gel"],
    [/\bgel[\s-]*douche\b/gi, "Shower Gel"],
    [/\bgel[\s-]*de[\s-]*ducha\b/gi, "Shower Gel"],
    [/\bdoucheg[eé]l\b/gi, "Shower Gel"],
    [/\bbagno[\s-]*schiuma\b/gi, "Bubble Bath"],
    [/\bbagnoschiuma\b/gi, "Bubble Bath"],
    [/\bschiuma da barba\b/gi, "Shaving Foam"],
    [/\bcrema da barba\b/gi, "Shaving Cream"],
    [/\bdeodorante\b/gi, "Deodorant"],
    [/\bshampooing\b/gi, "Shampoo"],
    [/\bchamp[uú]\b/gi, "Shampoo"],
    [/\bhaarshampoo\b/gi, "Shampoo"],
    [/\bzahnpasta\b/gi, "Toothpaste"],
    [/\bmundspülung\b/gi, "Mouthwash"],
    [/\bmundspuelung\b/gi, "Mouthwash"],
    [/\bmundwasser\b/gi, "Mouthwash"],
    [/\blippenpflege\b/gi, "Lip Balm"],
    [/\bkräuter\b/gi, "Herbs"],
    [/\bantibakterielle[nrs]?\b/gi, "Antibacterial"],
    [/\bantibakteriell\b/gi, "Antibacterial"],
    [/\beiswürfelform\b/gi, "Ice Cube Tray"],
    [/\beiswuerfelform\b/gi, "Ice Cube Tray"],
    [/\baus silikon\b/gi, "silicone"],
    [/\bsilikon\b/gi, "silicone"],
    [/\bcreme in der dose\b/gi, "Cream in a tin"],
    [/\bin der dose\b/gi, "in a tin"],
    [/\bgesichtscreme\b/gi, "Face Cream"],
    [/\bsonnencreme\b/gi, "Sun Cream"],
    [/\bsonnenspray\b/gi, "Sun Spray"],
    [/\bsonnenmilch\b/gi, "Sun Lotion"],
    [/\bfestes duschgel\b/gi, "Solid Shower Gel"],
    [/\bwaschgel\b/gi, "Face Wash"],
    [/\bpflegedusche\b/gi, "Shower Cream"],
    [/\bvollwaschmittel\b/gi, "Laundry Powder"],
    [/\bcolorwaschmittel\b/gi, "Color Laundry Detergent"],
    [/\bfeinwaschmittel\b/gi, "Delicate Detergent"],
    [/\bspülmittel\b/gi, "Dishwashing Liquid"],
    [/\bspuelmittel\b/gi, "Dishwashing Liquid"],
    [/\brasierschaum\b/gi, "Shaving Foam"],
    [/\brasier schaum\b/gi, "Shaving Foam"],
    [/\bzerstäuber\b/gi, "Spray"],
    [/\bzerstaeuber\b/gi, "Spray"],
    [/\bbrillant weiss\b/gi, "Brilliant White"],
    [/\bbrillant weiß\b/gi, "Brilliant White"],
    [/\bdentifricio\b/gi, "Toothpaste"],
    [/\bcrema (per il |per le )?mani\b/gi, "Hand Cream"],
    [/\bhandcreme\b/gi, "Hand Cream"],
    [/\bcrema (per il )?corpo\b/gi, "Body Cream"],
    [/\bk[öo]rpercreme\b/gi, "Body Cream"],
    [/\bcr[eè]me pour le corps\b/gi, "Body Cream"],
    [/\bpepino\b/gi, "Cucumber"],
    [/\brosas?\b/gi, "Rose"],
    [/\blim[aã]o\b/gi, "Lemon"],
    [/\blim[oó]n\b/gi, "Lemon"],
    [/\bfresa\b/gi, "Strawberry"],
    [/\bmorango\b/gi, "Strawberry"],
    [/\bleite\b/gi, "Milk"],
    [/\bleche\b/gi, "Milk"],
    [/\bfeuchtigkeit\b/gi, "Moisture"],
    [/\bsechskant[- ]holzschrauben\b/gi, "Hex Wood Screws"],
    [/\bsechskant[- ]holzschraube\b/gi, "Hex Wood Screw"],
    [/\bholzschrauben\b/gi, "Wood Screws"],
    [/\bholzschraube\b/gi, "Wood Screw"],
    [/\bschlüsselschrauben\b/gi, "Hex Wood Screws"],
    [/\bschlüsselschraube\b/gi, "Hex Wood Screw"],
    [/\bschluesselschrauben\b/gi, "Hex Wood Screws"],
    [/\bschluesselschraube\b/gi, "Hex Wood Screw"],
    [/\buniversalschrauben\b/gi, "Universal Screws"],
    [/\buniversalschraube\b/gi, "Universal Screw"],
    [/\bspanplattenschrauben\b/gi, "Chipboard Screws"],
    [/\bspanplattenschraube\b/gi, "Chipboard Screw"],
    [/\bmaschinenschrauben\b/gi, "Hex Bolts"],
    [/\bmaschinenschraube\b/gi, "Hex Bolt"],
    [/\bsechskantschrauben\b/gi, "Hex Bolts"],
    [/\bsechskantschraube\b/gi, "Hex Bolt"],
    [/\b6[- ]kant\b/gi, "Hex"],
    [/\bsechskant\b/gi, "Hex"],
    [/\bsenkkopf\b/gi, "countersunk"],
    [/\blinsenkopf\b/gi, "pan head"],
    [/\bflachkopf\b/gi, "flat head"],
    [/\bvollgewinde\b/gi, "full thread"],
    [/\bteilgewinde\b/gi, "partial thread"],
    [/\bdurchmesser\b/gi, ""],
    [/\bvpe\b/gi, "pack"],
    [/\bgalvanisch verzinkt\b/gi, "galvanized"],
    [/\bgalv\.?\s*verzinkt\b/gi, "galvanized"],
    [/\bverzinkt\b/gi, "galvanized"],
    [/\bverz\.\b/gi, "galvanized"],
    [/\bvz\b/gi, "galvanized"],
    [/\b(\d+)\s*stück\b/gi, "$1 pcs"],
    [/\bstück\b/gi, "pcs"],
    [/\buniversal[- ]flachheizk(?:ö|oe)rper\b/gi, "Universal Panel Radiator"],
    [/\bflachheizk(?:ö|oe)rper\b/gi, "Panel Radiator"],
    [/\bplattenheizk(?:ö|oe)rper\b/gi, "Panel Radiator"],
    [/\bheizk(?:ö|oe)rper\b/gi, "Radiator"],
    [/\baufh(?:ä|ae)ngelaschen\b/gi, "hanging brackets"],
    [/\b(\d+)\s*fach\b/gi, "$1-panel"],
    [/\btyp\s+(\d+)\b/gi, "Type $1"],
    [/\bb\s*x\s*h\s*:/gi, "W x H:"],
    [/\bmit\b/gi, "with"],
  ];
  for (const [pattern, english] of swaps) {
    text = text.replace(pattern, english);
  }
  text = text.replace(/\(\s*hp-?ve\s*=\s*(\d+)\s*\)?/gi, "$1 pcs");
  text = text.replace(/\bhp-?ve\s*=\s*(\d+)\b/gi, "$1 pcs");
  text = text.replace(/\b(\d+),0\s*[x×]\s*(\d+)\s*mm\b/gi, "$1x$2 mm");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*mm\b/gi, "$1x$2 mm");
  text = text.replace(/\bdin\b/gi, "DIN");
  text = text.replace(/\b(\d+)\s*st\.?\b/gi, "$1 pc");
  text = text.replace(/\s*,\s*,+/g, ",");
  text = text.replace(
    /\b(Shower Gel|Shampoo|Soap|Body Cream|Hand Cream|Deodorant)\s+(Cucumber|Rose|Lemon|Strawberry|Milk|Aloe|Coconut|Vanilla|Mint)\b/gi,
    "$2 $1"
  );
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*m[lL]\b/g, "$1 ml");
  text = text.replace(/\b(\d+),(\d+)\s*L\b/gi, "$1.$2 L");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)L\b/gi, "$1 L");
  text = text.replace(
    /\b(Coffee Grinder|Air Fryer|Coffee Machine|Kettle)\s+(Stainless Steel)/gi,
    "$1, $2"
  );
  text = text.replace(
    /\b(Stainless Steel(?:\/Black)?|Black|White|Silver)\s+(\d+\s*Watts)\b/gi,
    "$1, $2"
  );
  return cleanText(text);
}

function compactProductName(name: string) {
  const text = cleanText(name);
  if (
    /\b(stainless steel|watts|coffee grinder|air fryer|wood screw|hex bolt|universal screw|galvanized|pcs|full thread|countersunk|mouthwash|ice cube|silicone|cream in a tin)\b/i.test(
      text
    ) &&
    /,/.test(text)
  ) {
    return text;
  }
  const clause = text.split(/,(?=\s*[A-Za-zÄÖÜäöüß])|;|\s+[|]\s+/)[0].trim();
  if (clause.length >= 8 && clause.length <= 80 && looksLikeProductName(clause)) {
    return clause;
  }
  return text;
}

function specificItemName(name: string, brand = "", size = "") {
  return withSizeInName(
    compactProductName(
      withBrandInName(englishProductName(shortItemName(name) || name), firstBrand(brand))
    ),
    size
  );
}

function looksGerman(text: string) {
  const t = cleanText(text);
  if (!t) return false;
  if (/[äöüßÄÖÜ]/.test(t)) return true;
  return /\b(und|ohne|für|vom|zur|beim|einer|einem|heizk(?:ö|oe)rper|flachheiz|plattenheiz|schraube|schrauben|duschgel|mundspül|zahnpasta|k(?:ö|oe)rper|pflege|waschmittel|st(?:ü|ue)ck|bohrer|d(?:ü|ue)bel|aufh(?:ä|ae)nge|laschen|typ\s+\d+|mit\s+\S+)/i.test(
    t
  );
}

const nameTranslationCache = new Map<string, string>();

function restoreBrand(text: string, brand: string) {
  let out = cleanText(text).replace(/zzbrandzz/gi, brand);
  if (brand && !out.toLowerCase().includes(brand.toLowerCase())) {
    out = `${brand} ${out}`;
  }
  return cleanText(out);
}

async function translateGermanName(name: string, brand: string) {
  const source = cleanText(name);
  if (!source || !looksGerman(source)) return source;
  const kept = firstBrand(brand) || "";
  const cacheKey = `${kept}::${source.toLowerCase()}`;
  const cached = nameTranslationCache.get(cacheKey);
  if (cached) return cached;
  const payload = kept
    ? source.replace(new RegExp(kept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "ZZBRANDZZ")
    : source;
  const apply = (raw: string) => {
    const translated = restoreBrand(raw, kept);
    if (!translated || isJunkName(translated) || translated.length > 140) return "";
    return translated;
  };

  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=${encodeURIComponent(
        payload
      )}`,
      { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(5000), cache: "no-store" }
    );
    if (res.ok) {
      const json = (await res.json()) as unknown;
      const chunks = Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
      const text = chunks
        .map((row) => (Array.isArray(row) ? String(row[0] || "") : ""))
        .join("");
      const done = apply(text);
      if (done && !looksGerman(done)) {
        nameTranslationCache.set(cacheKey, done);
        return done;
      }
    }
  } catch {
    /* try other translators */
  }

  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?langpair=de|en&q=${encodeURIComponent(payload)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000), cache: "no-store" }
    );
    if (res.ok) {
      const json = (await res.json()) as { responseData?: { translatedText?: string } };
      const done = apply(json.responseData?.translatedText || "");
      if (done && !looksGerman(done)) {
        nameTranslationCache.set(cacheKey, done);
        return done;
      }
    }
  } catch {
    /* optional AI below */
  }

  const ai = await askClaude(
    "Translate this German shop product title into English. Keep the brand spelling exactly. Keep sizes, mm, Type, DIN, and numbers. Return only the English product name. Do not add words that are not in the title.",
    payload,
    80
  );
  const done = apply(ai);
  if (done) {
    nameTranslationCache.set(cacheKey, done);
    return done;
  }
  return source;
}

async function englishShopName(name: string, brand = "", size = "") {
  const local = specificItemName(name, brand, size);
  if (!looksGerman(local)) return local;
  const translated = await translateGermanName(name, brand);
  return specificItemName(translated || local, brand, size);
}

function shortItemName(name: string) {
  let text = cleanText(name);
  text = text.replace(
    /\s*[|\-–,]\s*-?\s*(go-upc|upcitemdb|buycott|barcode.?lookup|barcodepedia|codecheck|open food facts|ean.?search|wikipedia|geizhals|idealo|amazon|ebay|kaufland|merkandi|otto|lidl|mediamarkt|saturn|allegro|testbericht(?:\.de)?|dm\.de|rossmann|müller|mueller|action\.com|primark|bauhaus|obi\.de|hornbach|aldi|hagebau).*$/i,
    ""
  );
  text = text.replace(/\s*[-–|]\s*[\w.-]+\.(de|com|info|at|ch)\s*$/i, "");
  text = text.replace(/\s*[·•]\s*barcode\s*\d{8,14}.*$/i, "");
  text = text.replace(/\s*-\s*barcodepedia.*$/i, "");
  text = text.replace(/^\s*(n\/?d|s\/?m|n\.?\s*d\.?)\s+/i, "");
  text = text.replace(/\b(cx\.?|caja|box|pack|pck)\s*\.?\s*\d+\b/gi, "");
  text = text.replace(/\b(ean|gtin|upc|isbn)[:\s-]*\d{8,14}\b/gi, "");
  text = text.replace(/\b\d{12,14}\b/g, "");
  text = text.replace(/\s*(\.{2,}|…)\s*$/g, "");
  text = cleanText(text);
  if (text.length > 110) {
    text = text.slice(0, 110).replace(/\s+\S*$/, "").trim();
  }
  return text;
}

function labeledValue(raw: string, label: string) {
  return cleanText(raw.match(new RegExp(`${label}:\\s*([^.]*)`, "i"))?.[1] || "");
}

function labeledBlock(raw: string, label: string) {
  return cleanText(
    raw.match(
      new RegExp(
        `${label}:\\s*(.+?)(?=(?:Brand|Size|Category|Ingredients|Inhaltsstoffe|Zutaten|Allergens|Traces):|$)`,
        "i"
      )
    )?.[1] || ""
  );
}

function cleanIngredients(raw: unknown) {
  const text = cleanText(raw)
    .replace(/\b(en|de|fr|it|es|nl):\s*/gi, "")
    .replace(/[_*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 4) return "";
  if (isJunkBlurb(text) && text.length < 40) return "";
  const parts = text
    .split(/[,;•·]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(
      (part) =>
        part.length > 1 &&
        part.length < 80 &&
        !/^(ingredients?|zutaten|inhaltsstoffe|and|und)$/i.test(part)
    );
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
    if (unique.length >= 20) break;
  }
  if (unique.length >= 1) return unique.join(", ");
  return text.length > 320 ? `${text.slice(0, 320).replace(/[,;\s]+$/, "")}` : text;
}

function cleanCategory(raw: string) {
  const parts = cleanText(raw)
    .split(/,|>/)
    .map((part) =>
      part
        .replace(/^[a-z]{2}:/i, "")
        .replace(/[_-]+/g, " ")
        .trim()
    )
    .filter((part) => part.length > 2 && !/^[a-z]{2}$/i.test(part));
  return parts.slice(-2).join(", ");
}

function guessKind(name: string) {
  const text = name.toLowerCase();
  const hints: Array<[RegExp, string]> = [
    [/\b(shampoo|haarshampoo)\b/, "a hair shampoo"],
    [/\b(conditioner|spülung|spuelung)\b/, "a hair conditioner"],
    [/\b(duschgel|shower gel|gel de banho|gel de ba[nñ]o|gel bagno)\b/, "a shower gel"],
    [/\b(air fryer|hei(?:ss|ß)luftfritteuse|fritteuse)\b/, "an air fryer"],
    [/\b(farbe|paint|lack)\b/, "a paint"],
    [/\b(schraube|screw)\b/, "a screw pack"],
    [/\b(lampe|leuchte|lamp)\b/, "a lamp"],
    [/\b(bohrer|drill)\b/, "a drill"],
    [/\b(hex wood screw|holzschraube|schlüsselschraube)\b/, "a wood screw"],
    [/\b(universal screw|universalschraube)\b/, "a wood screw"],
    [/\b(hex bolt|sechskantschraube)\b/, "a hex bolt"],
    [/\b(coffee grinder|kaffeemühle)\b/, "a coffee grinder"],
    [/\b(coffee machine|kaffeemaschine)\b/, "a coffee machine"],
    [/\b(seife|soap)\b/, "a soap"],
    [/\b(zahnpasta|toothpaste)\b/, "a toothpaste"],
    [/\b(waschmittel|laundry detergent|detergent)\b/, "a laundry detergent"],
    [/\b(spülmittel|spuelmittel|dishwashing)\b/, "a dishwashing liquid"],
    [/\b(kaffee|coffee)\b/, "a coffee product"],
    [/\b(tee|tea)\b/, "a tea"],
    [/\b(saft|juice)\b/, "a juice drink"],
    [/\b(mineral water|mineralwasser|heilwasser|tafelwasser|sprudel|kohlensäure|carbonated)\b/, "a mineral water"],
    [/\b(milch|milk)\b/, "a milk product"],
    [/\b(wasser|water)\b/, "bottled water"],
    [/\b(olivenöl|olive oil)\b/, "an olive oil"],
    [/\b(sonnenblumenöl|sunflower oil)\b/, "a sunflower oil"],
    [/\b(\boil\b|öl)\b/, "a cooking oil"],
    [/\b(schokolade|chocolate)\b/, "a chocolate"],
    [/\b(chips|crisps)\b/, "a snack chips pack"],
    [/\b(reis|rice)\b/, "a rice pack"],
    [/\b(nudeln|pasta|spaghetti)\b/, "a pasta pack"],
    [/\b(mehl|flour)\b/, "a flour pack"],
    [/\b(zucker|sugar)\b/, "a sugar pack"],
    [/\b(salz|salt)\b/, "a salt pack"],
    [/\b(honig|honey)\b/, "a honey jar"],
    [/\b(marmelade|jam)\b/, "a jam"],
    [/\b(kekse|biscuit|cookie)\b/, "a biscuit pack"],
    [/\b(bonbon|candy|sweets)\b/, "a candy pack"],
    [/\b(creme|cream|lotion)\b/, "a skin cream"],
    [/\b(deodorant|deo)\b/, "a deodorant"],
    [/\b(windeln|diaper)\b/, "baby diapers"],
    [/\b(futter|pet food)\b/, "a pet food pack"],
  ];
  return hints.find(([re]) => re.test(text))?.[1] || "";
}

function wordOverlap(a: string, b: string) {
  const wa = new Set(
    a.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter((w) => w.length > 3)
  );
  const wb = b.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter((w) => w.length > 3);
  if (!wb.length) return 0;
  return wb.filter((w) => wa.has(w)).length / wb.length;
}

function uniqueSentences(sentences: string[]) {
  const out: string[] = [];
  for (const raw of sentences) {
    let text = cleanText(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!/[.!?]$/.test(text)) text += ".";
    if (out.some((other) => wordOverlap(other, text) >= 0.55)) continue;
    out.push(text);
  }
  return out.join(" ");
}

function scentFromName(name: string) {
  const text = name.toLowerCase();
  const scents: Array<[RegExp, string]> = [
    [/\b(rose|rosa)\b/, "rose"],
    [/\b(cucumber|pepino|gurke)\b/, "cucumber"],
    [/\b(lemon|zitrone|lim[aã]o|lim[oó]n)\b/, "lemon"],
    [/\b(strawberry|erdbeere|fresa|morango)\b/, "strawberry"],
    [/\b(milk|milch|leite|leche)\b/, "milk"],
    [/\b(aloe)\b/, "aloe"],
    [/\b(coconut|kokos|coco)\b/, "coconut"],
    [/\b(vanilla|vanille|vainilla)\b/, "vanilla"],
    [/\b(mint|minze|menta)\b/, "mint"],
  ];
  return scents.find(([re]) => re.test(text))?.[1] || "";
}

function guessUse(name: string, kind: string, category: string) {
  const text = `${name} ${kind} ${category}`.toLowerCase();
  if (/shampoo|hair conditioner|haar/.test(text)) {
    return "Follow the amount on the bottle.";
  }
  if (/shower gel|soap|dusch/.test(text)) {
    return "Use a little on wet skin.";
  }
  if (/laundry|waschmittel|detergent/.test(text)) {
    return "Follow the dose on the pack.";
  }
  if (/dish|spül/.test(text)) {
    return "Use a small amount in warm water.";
  }
  if (/coffee|tea|juice|milk|water|drink|getränk|mineral/.test(text)) {
    return "Serve chilled, or as written on the bottle.";
  }
  if (/oil|öl/.test(text)) {
    return "Keep the bottle closed after cooking or salad use.";
  }
  if (/chocolate|candy|biscuit|chips|snack|sweet/.test(text)) {
    return "Keep it dry and away from heat.";
  }
  if (/pasta|rice|flour|sugar|salt/.test(text)) {
    return "Cook or use as written on the pack.";
  }
  if (/cream|lotion|deo|toothpaste/.test(text)) {
    return "Keep the lid closed after use.";
  }
  return "";
}

function isTemplateBlurb(text: string) {
  return /is sold as a retail pack|for everyday use|is a shop item|use a little on wet skin|the pack size is|catalog found|für den alltag|ist ein ladenartikel|die packungsgröße/i.test(
    text
  );
}

function isJunkBlurb(text: string) {
  const t = cleanText(text);
  if (!t) return true;
  if (isTemplateBlurb(t)) return true;
  if (/\b(n\/d|gel de banho|gel de ba[nñ]o|cx\.\s*\d+)\b/i.test(t)) return true;
  if (/ean finder|suchen, validieren|produktcode|recherche de produits|ean-suche/i.test(t)) {
    return true;
  }
  return t.length < 90 && isJunkName(t);
}

export function clearEnglishDescription(name: string, raw = "") {
  const product = cleanText(name).replace(/\.$/, "");
  if (!product) return "";
  let extra = cleanText(raw);
  const extraHasIngredients = /ingredients?:|zutaten:|inhaltsstoffe:/i.test(extra);
  if (
    extra.toLowerCase() === product.toLowerCase() ||
    (isJunkBlurb(extra) && !extraHasIngredients)
  ) {
    extra = extraHasIngredients ? extra : "";
  }

  const brand = labeledValue(extra, "Brand");
  const size =
    labeledValue(extra, "Size") ||
    cleanText(extra.match(/\b\d+[\d.,]*\s*(ml|l|cl|g|kg|oz|pcs|stück|pack)\b/i)?.[0] || "");
  const category = cleanCategory(labeledValue(extra, "Category"));
  const ingredients = cleanIngredients(
    labeledBlock(extra, "Ingredients") ||
      labeledBlock(extra, "Inhaltsstoffe") ||
      labeledBlock(extra, "Zutaten")
  );
  const allergens = cleanIngredients(
    labeledBlock(extra, "Allergens") || labeledBlock(extra, "Traces")
  );
  let story = extra
    .replace(/Brand:\s*[^.]*\.?/gi, " ")
    .replace(/Size:\s*[^.]*\.?/gi, " ")
    .replace(/Category:\s*[^.]*\.?/gi, " ")
    .replace(/Ingredients:\s*.+?(?=(?:Brand|Size|Category|Allergens|Traces):|$)/gi, " ")
    .replace(/Inhaltsstoffe:\s*.+?(?=(?:Brand|Size|Category|Allergens|Traces):|$)/gi, " ")
    .replace(/Zutaten:\s*.+?(?=(?:Brand|Size|Category|Allergens|Traces):|$)/gi, " ")
    .replace(/Allergens:\s*[^.]*\.?/gi, " ")
    .replace(/Traces:\s*[^.]*\.?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (isJunkBlurb(story) || story.length < 24) story = "";
  story = cleanText(story);

  const kind = guessKind(`${product} ${category} ${story}`);
  const packSize = size || extractSize(product, extra);
  const scent = scentFromName(`${product} ${story}`);
  const words = product.split(/\s+/);
  const brandName =
    firstBrand(brand) ||
    (/^(bad|san|el|la|le|von|van)$/i.test(words[0] || "") && words[1]
      ? `${words[0]} ${words[1]}`
      : words[0]) ||
    product;
  const sentences: string[] = [];
  const richCatalog = story.length >= 40;

  if (richCatalog) {
    const parts = story.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    sentences.push(...parts);
  } else {
    if (kind) {
      sentences.push(
        packSize
          ? `${product} is ${kind}. The pack size is ${packSize}.`
          : `${product} is ${kind}.`
      );
    } else if (category) {
      sentences.push(
        packSize
          ? `${product} is a ${category.toLowerCase()} item. The pack size is ${packSize}.`
          : `${product} is a ${category.toLowerCase()} item.`
      );
    } else {
      sentences.push(
        packSize
          ? `${product} is a shop pack. The pack size is ${packSize}.`
          : `${product} is a shop pack.`
      );
    }
    if (scent) {
      sentences.push(`The scent is ${scent}.`);
    } else if (/lightly carbonated|\bmedium\b/i.test(`${product} ${story}`)) {
      sentences.push("It is lightly sparkling mineral water.");
    } else if (/carbonated/i.test(`${product} ${story}`) && /water/i.test(`${product} ${kind}`)) {
      sentences.push("It is sparkling mineral water.");
    }
    if (brandName && !product.toLowerCase().includes(brandName.toLowerCase())) {
      sentences.push(`The brand is ${brandName}.`);
    }
    if (story.length > 12) {
      sentences.push(story.charAt(0).toUpperCase() + story.slice(1));
    }
  }

  if (packSize && !sentences.join(" ").toLowerCase().includes(packSize.toLowerCase())) {
    sentences.push(`The pack size is ${packSize}.`);
  }
  if (ingredients && !/ingredients?:/i.test(sentences.join(" "))) {
    sentences.push(`Ingredients: ${ingredients}.`);
  }
  if (
    allergens &&
    !/allergen|traces/i.test(sentences.join(" ")) &&
    (!ingredients || !ingredients.toLowerCase().includes(allergens.toLowerCase()))
  ) {
    sentences.push(`Allergens / traces: ${allergens}.`);
  }
  if (!richCatalog) {
    const use = guessUse(product, kind, category);
    if (use) sentences.push(use);
  }

  return uniqueSentences(sentences).slice(0, 720);
}

function hitLooksWeak(name: string) {
  const text = cleanText(name);
  if (!text || isJunkName(text)) return true;
  if (/\bwith\s+\d+$/i.test(text) || /\bmit\s+\d+$/i.test(text)) return true;
  if (/^(understanding|discover|explore|learn|why|how|what|when|where)\b/i.test(text)) return true;
  return /\b(n\/d|s\/m|gel de banho|gel de ba[nñ]o|gel bagno|cx\.?\s*\d+|caja de|your clothes|in your)\b/i.test(text);
}

function hitsAreStrong(hits: CatalogHit[]) {
  return hits.some(
    (hit) => hit.trusted && !hitLooksWeak(hit.name) && germanScore(hit) >= 50
  );
}

function gs1Language(code: string) {
  const prefix = code.replace(/^0+/, "").slice(0, 3);
  if (/^84/.test(prefix)) return "es";
  if (/^80/.test(prefix)) return "it";
  if (/^56/.test(prefix)) return "pt";
  if (/^30|^31|^32|^33|^34|^35|^36|^37/.test(prefix)) return "fr";
  return "de";
}

function clientShopSearchUrls(code: string) {
  const q = encodeURIComponent(code);
  return [
    `https://www.dm.de/search?query=${q}&searchType=product`,
    `https://www.rossmann.de/de/search?text=${q}`,
    `https://www.mueller.de/suche/?query=${q}`,
    `https://www.lidl.de/q/search?q=${q}`,
    `https://www.action.com/de-de/search/?q=${q}`,
    `https://www.aldi-sued.de/de/suche.html?query=${q}`,
    `https://www.aldi-nord.de/suche.html?query=${q}`,
    `https://www.primark.com/de-de/search?q=${q}`,
    `https://www.bauhaus.info/suche/produkte?search=${q}`,
    `https://www.obi.de/search/${q}`,
    `https://www.hornbach.de/shop/suche/sortiment/${q}`,
  ];
}

function catalogPagesFor(code: string) {
  const q = encodeURIComponent(code);
  const prefix = code.replace(/^0+/, "").slice(0, 3);
  const pages = [
    ...clientShopSearchUrls(code),
    `https://barcodepedia.com/${code.replace(/\D/g, "")}`,
    `https://www.upcitemdb.com/upc/${q}`,
    `https://www.barcodelookup.com/${q}`,
    `https://www.ean-search.org/?q=${q}`,
    `https://world.openbeautyfacts.org/product/${q}`,
    `https://de.openbeautyfacts.org/product/${q}`,
    `https://world.openproductsfacts.org/product/${q}`,
    `https://de.openproductsfacts.org/product/${q}`,
    `https://de.openfoodfacts.org/product/${q}`,
  ];
  if (/^4[0-4]/.test(prefix) || /^9[0-9]/.test(prefix)) {
    pages.push(`https://www.codecheck.info/product.search?q=${q}`);
    pages.push(`https://www.barcoo.com/de/${q}`);
  }
  if (/^69/.test(prefix)) {
    pages.push(`https://www.homelux-shop.de/search?q=${q}`);
    pages.push(`https://merkandi.com/search?q=${q}`);
    pages.push(`https://www.kaufland.de/s/?search_value=${q}`);
  }
  return [...new Set(pages)];
}

function webSearchQueries(code: string) {
  const prefix = code.replace(/^0+/, "").slice(0, 3);
  const quoted = `"${code}"`;
  const queries = [
    quoted,
    code,
    `${quoted} EAN`,
    `${code} EAN`,
    `${code} GTIN`,
    `${code} Produkt`,
    `${code} barcode`,
  ];
  if (/^84/.test(prefix)) queries.push(`${code} producto EAN`, `${code} código de barras`);
  if (/^528/.test(prefix)) queries.push(`${code} Lebanon EAN`, `${code} product barcode`);
  if (/^4[0-4]/.test(prefix)) {
    queries.push(`${code} EAN Produkt Deutschland`);
  }
  queries.push(
    `${quoted} site:dm.de`,
    `${quoted} site:rossmann.de`,
    `${quoted} site:mueller.de`,
    `${quoted} site:lidl.de`,
    `${quoted} site:action.com`,
    `${quoted} site:aldi-sued.de`,
    `${quoted} site:primark.com`,
    `${quoted} site:bauhaus.info`,
    `${quoted} site:obi.de`,
    `${quoted} site:hornbach.de`
  );
  if (/^69/.test(prefix)) {
    queries.push(
      `${code} Kaufland`,
      `${code} Merkandi`,
      `${code} Heißluftfritteuse`,
      `${code} air fryer`,
      `${code} Fritteuse`
    );
  }
  return [...new Set(queries)];
}

function germanScore(hit: CatalogHit) {
  const text = `${hit.name} ${hit.description}`;
  let score = 40 - Math.abs(hit.name.length - 36);
  if (hit.trusted) score += 80;
  if (
    /\b(shower gel|shampoo|conditioner|toothpaste|body cream|hand cream|deodorant|bubble bath|shaving foam|shaving cream|body wash|mineral water|air fryer|coffee grinder|coffee machine|kettle|lip balm|hex bolt|wood screw|universal screw|mouthwash|ice cube|cream in a tin|panel radiator|radiator)\b/i.test(
      hit.name
    )
  ) {
    score += 70;
  }
  if (/\b\d+(?:[.,]\d+)?\s*(ml|l|g|kg|pcs)\b/i.test(hit.name)) score += 25;
  if (/\b(din\s*933|din\s*571|m8\s*x\s*40|8\s*x\s*40|100\s*pcs|200\s*pcs)\b/i.test(hit.name)) {
    score += 25;
  }
  if (
    /[äöüÄÖÜß]/.test(hit.name) ||
    /\b(schraube|schlüssel|holz|sechskant|verzinkt|senkkopf|vollgewinde|universalschraube)\b/i.test(
      hit.name
    )
  ) {
    score -= 20;
  }
  if (/\b(scheffler|lq-?\d+)\b/i.test(hit.name)) score += 20;
  if (
    /\b(gel bagno|gel bano|gel baño|gel de banho|duschgel|docciaschiuma|bagnoschiuma|deodorante|zahnpasta|dentifricio|n\/d|cx\.?\s*\d+)\b/i.test(
      hit.name
    )
  ) {
    score -= 60;
  }
  if (/[а-яА-ЯіІїЇєЄ]/.test(hit.name)) score -= 50;
  if (/\b(the|and|with|for|ml|pack)\b/i.test(text)) score += 15;
  if ((hit.name.match(/,/g) || []).length > 3) score -= 50;
  if (/\b(ean|upc|gtin|suche|search|recherche)\b/i.test(hit.name)) score -= 80;
  return score;
}

function htmlHasBarcode(html: string, code: string) {
  if (!html) return false;
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/https?:\/\/[^\s"'<>)]+/gi, " ")
    .replace(/[?&](?:q|query|text|search|searchTerm|search_value)=[\d]+/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return barcodeVariants(code).some((digits) => digits.length >= 8 && body.includes(digits));
}

function isShopSearchUrl(url: string) {
  return (
    /\/(suche|search|q\/search|sortiment)(\/|\?|$)/i.test(url) ||
    /[?&](q|query|text|search|searchTerm|search_value)=/i.test(url)
  );
}

function isPricedOfferName(name: string) {
  return (
    /€|eur\b|wochenangebote|\d+,\d+\s*€|\/\s*(kg|m2|st|l)\b|\d+\s*von\s*\d+/i.test(name)
  );
}

function codesMatch(found: string, expected: string) {
  const a = found.replace(/\D/g, "");
  const b = expected.replace(/\D/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const as = a.replace(/^0+/, "");
  const bs = b.replace(/^0+/, "");
  if (as && bs && as === bs) return true;
  if (a.length >= 12 && b.length >= 12 && a.slice(-12) === b.slice(-12)) return true;
  if (a.length >= 13 && b.length >= 13 && a.slice(-13) === b.slice(-13)) return true;
  return false;
}

function lookupMissHtml(html: string) {
  const title = `${html.match(/<title[^>]*>\s*([^<]+)/i)?.[1] || ""} ${
    html.match(/<h1[^>]*>\s*([^<]+)/i)?.[1] || ""
  }`;
  const text = `${title} ${cleanText(html).slice(0, 2500)}`;
  return /product not found|no product found|we couldn['’]t find|keine treffer|nicht gefunden|no item found|0\s*(artikel|produkte|treffer|ergebnisse)|keine\s+(artikel|produkte|treffer|ergebnisse)|leider\s+nichts gefunden/i.test(
    text
  );
}

function shopSearchHasNoProduct(html: string) {
  if (!html || isChallengeHtml(html) || lookupMissHtml(html)) return true;
  return /0\s*(artikel|produkte|treffer|ergebnisse)|keine\s+(artikel|produkte|treffer|ergebnisse)|keine produkte gefunden/i.test(
    cleanText(html).slice(0, 4000)
  );
}

function productUrlsFromShopHtml(html: string, pageUrl: string) {
  const urls: string[] = [];
  let host = "";
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return urls;
  }
  const hrefs = [
    ...html.matchAll(/href=["']([^"']+)["']/gi),
    ...html.matchAll(/\((https?:[^)]+)\)/g),
  ];
  for (const match of hrefs) {
    let href = (match[1] || "").replace(/&amp;/g, "&");
    if (href.startsWith("/")) href = `https://www.${host}${href}`;
    const url = decodeSearchUrl(href) || href;
    if (!/^https?:/i.test(url) || isShopSearchUrl(url)) continue;
    if (!isClientShopProductUrl(url, host)) continue;
    if (!urls.includes(url)) urls.push(url);
    if (urls.length >= 4) break;
  }
  return urls;
}

function isJunkName(name: string) {
  const text = shortItemName(name) || name.trim();
  if (!text || text.length < 3 || text.length > 140) return true;
  if (/\?/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (
    /\b(ean|upc|isbn|gtin)\b/i.test(text) &&
    /search|suche|recherche|lookup|database|datenbank|finder|code/i.test(text)
  ) {
    return true;
  }
  if (
    /just a moment|attention required|verifizierung|checking if the site|unusual traffic|too many requests|no page for this barcode|wholesale joblot|bestseller|alle produkte|alle entfernen|direkt zum inhalt|suchergebnisse|1 ergebnis|filtern und sortieren|testbericht|allegro|dauerhaft g(?:ü|ue)nstig|client challenge|spare \d+\s*%|gutes für alle|startseite|^suche$|^search$|^home$|^shop$|wochenangebote|was suchen sie/i.test(
      text
    )
  ) {
    return true;
  }
  if (isPricedOfferName(text)) return true;
  if (
    /www\.|https?:|\.de\/|\.com\/|\.eu\/|\.rs\/|\.org\/|\.ro\/|\.ch\b|\bhagebau\b|\/p\/|\/produkt|\/products\/|qogita|budni\.|depha|autodoc|grobmotorik|motorrad|motorcycle|inhaltsstoffe eingeordnet|schreiben sie einen kommentar|product summary|artikel-nr|barcode:|код товар|auf lager|zum besten preis|0222\/001|^das produkt\b|\bbietet eine\b|\bmit$/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /^(aldi süd|aldi nord|dm.?drogerie|rossmann|müller|mueller|lidl|obi|hornbach|primark|action|bauhaus)(\s|$)/i.test(
      text
    ) &&
    !/\b(shampoo|soap|gel|ml|l|pack|schraube|farbe|lampe)\b/i.test(text)
  ) {
    return true;
  }
  if (
    /\b(porn|pornstars?|xxx|onlyfans|xvideos|xnxx|hentai|simpbun|adult video|verified by gs1|gtins?\s*&|dualsense|r(?:ü|ue)ckw(?:ä|ae)rtssuche|telefonnummer|telefonbuch|wer ruft an|anrufer|reverse (?:phone|lookup)|phone number|caller id)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return /ean-?suche|ean-?search|ean finder|open ean|suchergebnisse|welches produkt|steckt hinter|datenbank|produktbewertung|validieren|generieren|produktcode|suche:|recherche de produits|produits par|par ean|barcode lookup|upc lookup|not found|404|search results|look\s*up|duckduckgo|wikipedia|buycott|itemdb|home page|codecheck|barcoo|openean|gtin db|retail product|mid-tower|atx,|preisvergleich|lowest price|best price|idealo|geizhals|amazon\.|ebay\.|understanding the|fibres? in your|in your clothes|sustainability|blog|how to |guide to |everything you need/i.test(
    text
  );
}

function isChallengeHtml(html: string) {
  return /just a moment|attention required|verifizierung erforderlich|unusual traffic|checking if the site|enablejs|cf-mitigated|why have i been blocked|client challenge/i.test(
    html.slice(0, 4000)
  );
}

function flattenLd(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenLd);
  if (typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...flattenLd(node["@graph"])];
}

function jsonLdBrandValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return firstBrand(value);
  if (Array.isArray(value)) return jsonLdBrandValue(value[0]);
  if (typeof value === "object") {
    const node = value as Record<string, unknown>;
    return firstBrand(node.name || node.brand);
  }
  return "";
}

function jsonLdProduct(html: string) {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].replace(/[\u0000-\u001f]+/g, " "));
      for (const node of flattenLd(parsed)) {
        const type = String(node["@type"] || "");
        if (!/product/i.test(type)) continue;
        const raw = Array.isArray(node.name) ? node.name[0] : node.name;
        const name = cleanText(raw);
        if (isJunkName(name)) continue;
        const offers = node.offers as unknown;
        const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
        let priceEur = 0;
        for (const offer of offerList) {
          const row = (offer || {}) as Record<string, unknown>;
          const currency = String(row.priceCurrency || row.currency || "EUR");
          if (currency && !/EUR/i.test(currency)) continue;
          priceEur = parseEuroAmount(row.price ?? row.lowPrice);
          if (priceEur > 0) break;
        }
        return {
          name,
          brand: jsonLdBrandValue(node.brand),
          size: extractSize(
            node.size,
            node.weight,
            typeof node.additionalProperty === "string" ? node.additionalProperty : "",
            name
          ),
          priceEur,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return { name: "", brand: "", size: "", priceEur: 0 };
}

function jsonLdProductName(html: string) {
  return jsonLdProduct(html).name;
}

function brandFromHtml(html: string) {
  return (
    jsonLdProduct(html).brand ||
    firstBrand(
      tableValue(html, "Brand") ||
        tableValue(html, "Marke") ||
        tableValue(html, "Hersteller") ||
        tableValue(html, "Manufacturer")
    )
  );
}

function hitFromOffProduct(
  product: Record<string, unknown> | null,
  expectedCode = ""
): CatalogHit[] {
  if (!product) return [];
  if (expectedCode) {
    const productCode = String(product.code || product._id || "");
    if (productCode && !codesMatch(productCode, expectedCode)) return [];
  }
  const names = [
    product.product_name_en,
    product.product_name,
    product.product_name_de,
    product.generic_name_en,
    product.generic_name,
    product.generic_name_de,
  ]
    .map(cleanText)
    .filter((name, index, list) => name && list.indexOf(name) === index && !isJunkName(name));
  const brand = firstBrand(product.brands);
  const size = extractSize(
    product.quantity,
    product.product_quantity != null
      ? `${product.product_quantity} ${product.product_quantity_unit || ""}`
      : "",
    product.serving_size,
    ...names
  );
  const ingredients = cleanIngredients(
    product.ingredients_text_en ||
      product.ingredients_text_de ||
      product.ingredients_text
  );
  const allergens = cleanIngredients(
    product.allergens || product.allergens_from_ingredients || product.traces
  );
  return names.map((name) => {
    const fullName = specificItemName(name, brand, size);
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          product.generic_name_en || product.generic_name_de || product.generic_name,
          brand ? `Brand: ${brand}` : "",
          size ? `Size: ${size}` : "",
          product.categories ? `Category: ${cleanCategory(cleanText(product.categories))}` : "",
          ingredients ? `Ingredients: ${ingredients}` : "",
          allergens ? `Allergens: ${allergens}` : "",
        ])
      ),
      trusted: true,
    };
  });
}

async function fetchJson(url: string, timeoutMs = 3500) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, timeoutMs = 4000, retries = 0) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "follow",
      });
      if (res.status === 429 && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      if (!res.ok) return "";
      const html = await res.text();
      if (isChallengeHtml(html)) return "";
      return html;
    } catch {
      if (attempt >= retries) return "";
    }
  }
  return "";
}

async function fetchMarkdown(url: string, timeoutMs = 12000) {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain, text/markdown",
        "X-Retain-Images": "none",
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return "";
    const text = await res.text();
    if (!text || isChallengeHtml(text)) return "";
    return text;
  } catch {
    return "";
  }
}

function namesFromHtml(html: string) {
  if (!html) return [];
  const found: string[] = [];
  const push = (value: string) => {
    const name = shortItemName(value);
    if (!name || isJunkName(name)) return;
    if (found.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    found.push(name);
  };
  push(jsonLdProductName(html));
  const og =
    html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i);
  push(og?.[1] || "");
  for (const match of html.matchAll(/<h1[^>]*>\s*([^<]{3,160})\s*<\/h1>/gi)) {
    push(match[1]);
  }
  for (const match of html.matchAll(
    /(?:itemprop=["']name["']|class=["'][^"']*(?:product-name|product_title|productTitle)[^"']*["'])[^>]*>\s*([^<]{3,160})/gi
  )) {
    push(match[1]);
  }
  const title = html.match(/<title>\s*([^<]+)\s*<\/title>/i);
  push(title?.[1] || "");
  return found;
}

function nameFromHtml(html: string) {
  return namesFromHtml(html)[0] || "";
}

function tableValue(html: string, label: string) {
  const re = new RegExp(`${label}\\s*</t[dh]>\\s*<t[dh][^>]*>\\s*([^<]+)`, "i");
  return cleanText(html.match(re)?.[1] || "");
}

function sizeFromHtml(html: string) {
  const labels = [
    "Quantity",
    "Size",
    "Weight",
    "Volume",
    "Net Weight",
    "Net content",
    "Inhalt",
    "Menge",
    "Füllmenge",
    "Pack Size",
  ];
  for (const label of labels) {
    const size = formatSize(tableValue(html, label));
    if (size) return size;
  }
  return extractSize(cleanText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 2500));
}

function ingredientsFromHtml(html: string) {
  const heading = html.match(
    /<(?:h2|h3|dt|th|strong)[^>]*>\s*(?:ingredients?|zutaten|inhaltsstoffe)[^<]*<\/[^>]+>\s*<(?:p|dd|td|div)[^>]*>([\s\S]{6,900}?)<\//i
  );
  return cleanIngredients(
    tableValue(html, "Ingredients") ||
      tableValue(html, "Inhaltsstoffe") ||
      tableValue(html, "Zutaten") ||
      tableValue(html, "Zusammensetzung") ||
      tableValue(html, "Composition") ||
      heading?.[1] ||
      ""
  );
}

function ingredientsFromText(raw: string) {
  return cleanIngredients(
    labeledBlock(raw, "Ingredients") ||
      labeledBlock(raw, "Inhaltsstoffe") ||
      labeledBlock(raw, "Zutaten") ||
      raw.match(/ingredients?:\s*(.+)/i)?.[1] ||
      ""
  );
}

async function lookupOpenFactsCode(code: string): Promise<CatalogHit[]> {
  return collectHitsFast(
    OFF_HOSTS.map((host) =>
      fetchJson(`${host}/api/v2/product/${encodeURIComponent(code)}.json`).then((json) => {
        if (!json) return null;
        if (json.status !== 1 && json.status !== "success") return null;
        return hitFromOffProduct(json.product as Record<string, unknown>, code);
      })
    ),
    2000,
    120
  );
}

let goUpcQueue: Promise<unknown> = Promise.resolve();

async function lookupBarcodepedia(code: string): Promise<CatalogHit | null> {
  const digits = code.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const urls = [...new Set([`https://barcodepedia.com/${digits}`, `https://barcodepedia.com/${digits.padStart(14, "0")}`])];
  for (const url of urls) {
    const html = await fetchHtml(url, 4200);
    if (!html || lookupMissHtml(html)) continue;
    if (/no product|not on file|we couldn['’]t find|product not found/i.test(html.slice(0, 2500))) {
      continue;
    }
    const heading = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const name = shortItemName(heading) || nameFromHtml(html);
    if (!name || isJunkName(name) || /barcodepedia/i.test(name)) continue;
    const brand = firstBrand(tableValue(html, "Brand") || brandFromHtml(html));
    const size =
      formatSize(tableValue(html, "Size") || tableValue(html, "Net content")) || extractSize(name);
    const category = tableValue(html, "Category");
    const about =
      cleanText(
        html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i)?.[1] ||
          html.match(/content=["']([^"']+)["'][^>]*property=["']og:description["']/i)?.[1] ||
          ""
      ) ||
      cleanText(
        html.match(/<p[^>]*>([\s\S]{40,420}?)<\/p>/i)?.[1] || ""
      );
    const fullName = specificItemName(name, brand, size);
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          brand ? `Brand: ${brand}` : "",
          size ? `Size: ${size}` : "",
          category ? `Category: ${category}` : "",
          ingredientsFromHtml(html) ? `Ingredients: ${ingredientsFromHtml(html)}` : "",
          isJunkBlurb(about) ? "" : about,
        ])
      ),
      trusted: true,
    };
  }
  return null;
}

async function lookupGoUpc(code: string): Promise<CatalogHit | null> {
  const run = async (): Promise<CatalogHit | null> => {
    const html = await fetchHtml(
      `https://go-upc.com/search?q=${encodeURIComponent(code)}`,
      4500,
      1
    );
    if (!html || lookupMissHtml(html)) return null;
    const name = nameFromHtml(html);
    if (!name) return null;
    const brand = brandFromHtml(html);
    const size = jsonLdProduct(html).size || sizeFromHtml(html) || extractSize(name);
    const ingredients = ingredientsFromHtml(html);
    const fullName = specificItemName(name, brand, size);
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          tableValue(html, "Category")
            ? `Category: ${tableValue(html, "Category")}`
            : "",
          brand ? `Brand: ${brand}` : "",
          size ? `Size: ${size}` : "",
          ingredients ? `Ingredients: ${ingredients}` : "",
          tableValue(html, "Description"),
        ])
      ),
      trusted: Boolean(jsonLdProductName(html)),
    };
  };
  const queued = goUpcQueue.then(run, run);
  goUpcQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

async function lookupUpcItemDb(code: string): Promise<CatalogHit[]> {
  const json = await fetchJson(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
  );
  const items = (json?.items as Record<string, unknown>[]) || [];
  const hits: CatalogHit[] = [];
  for (const item of items) {
    const foundCode = cleanText(item.upc || item.ean || item.gtin || "");
    if (foundCode && !codesMatch(foundCode, code)) continue;
    if (!foundCode && items.length > 1) continue;
    const name = cleanText(item.title || item.description);
    if (isJunkName(name)) continue;
    const brand = firstBrand(item.brand);
    const size = extractSize(item.size, item.dimension, item.description, name);
    const ingredients = cleanIngredients(
      item.ingredients || labeledBlock(cleanText(item.description), "Ingredients")
    );
    const fullName = specificItemName(name, brand, size);
    hits.push({
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          item.category ? `Category: ${cleanText(item.category)}` : "",
          brand ? `Brand: ${brand}` : "",
          size ? `Size: ${size}` : "",
          ingredients ? `Ingredients: ${ingredients}` : "",
          cleanText(item.description),
        ])
      ),
      trusted: true,
    });
  }
  return hits;
}

async function lookupIcecat(code: string, language = "de"): Promise<CatalogHit | null> {
  const json = await fetchJson(
    `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=${encodeURIComponent(language)}&GTIN=${encodeURIComponent(code)}`
  );
  const data = json?.data as Record<string, unknown> | undefined;
  const info = data?.GeneralInfo as Record<string, unknown> | undefined;
  if (!info) return null;
  const name = cleanText(info.Title || info.ProductName || info.Name);
  if (isJunkName(name)) return null;
  const iceSize = extractSize(
    name,
    (info.Description as Record<string, unknown> | undefined)?.Lead,
    JSON.stringify(info).slice(0, 1500)
  );
  const brand = firstBrand(
    (info.Brand as Record<string, unknown> | undefined)?.Name || info.Brand
  );
  const fullName = specificItemName(name, brand, iceSize);
  const summary = cleanText(
    info.SummaryDescription ||
      info.ShortSummaryDescription ||
      info.LongSummaryDescription ||
      (info.Description as Record<string, unknown> | undefined)?.Lead
  );
  const category = cleanText(
    (info.Category as Record<string, unknown> | undefined)?.Name || info.Category
  );
  return {
    name: fullName,
    description: clearEnglishDescription(
      fullName,
      describeFromParts([
        brand ? `Brand: ${brand}` : "",
        category ? `Category: ${category}` : "",
        iceSize ? `Size: ${iceSize}` : "",
        summary,
      ])
    ),
    trusted: true,
  };
}

function ingredientsFromMarkdown(markdown: string) {
  const block =
    markdown.match(
      /ingredients?:\s*([A-Za-z][\s\S]{8,900}?)(?:\n\n|\n#{1,3}\s|$)/i
    )?.[1] ||
    markdown.match(
      /inhaltsstoffe\s*(?:ingredients?:)?\s*([A-Za-z][\s\S]{8,900}?)(?:\n\n|\n#{1,3}\s|$)/i
    )?.[1] ||
    "";
  return cleanIngredients(block);
}

function drugstoreHit(
  name: string,
  brand: string,
  size: string,
  ingredients: string,
  extra = "",
  priceEur = 0
): CatalogHit | null {
  const fullName = specificItemName(name, brand, size);
  if (!fullName || isJunkName(fullName) || hitLooksWeak(fullName)) return null;
  return {
    name: fullName,
    description: clearEnglishDescription(
      fullName,
      describeFromParts([
        brand ? `Brand: ${brand}` : "",
        size ? `Size: ${size}` : "",
        ingredients ? `Ingredients: ${ingredients}` : "",
        extra,
      ])
    ),
    trusted: true,
    priceEur: priceEur > 0 ? priceEur : undefined,
  };
}

async function fetchDmSearch(query: string) {
  if (!query) return [];
  let json: Record<string, unknown> | null = null;
  try {
    const res = await fetch(
      `https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(query)}&searchType=product&pageSize=10`,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json",
          "Accept-Language": "de-DE,de;q=0.9",
        },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      }
    );
    if (res.ok) json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!json) {
    json = await fetchJson(
      `https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(query)}&searchType=product&pageSize=10`
    );
  }
  return (json?.products as Record<string, unknown>[]) || [];
}

function dmPriceFromProduct(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  const tracking = (tile.trackingData as Record<string, unknown> | undefined) || {};
  const priceNode = (tile.price as Record<string, unknown> | undefined) || {};
  const current =
    ((priceNode.price as Record<string, unknown> | undefined)?.current as
      | Record<string, unknown>
      | undefined) || {};
  return (
    parseEuroAmount(tracking.price) ||
    parseEuroAmount(current.value) ||
    euroPriceFromText(String(current.value || ""))
  );
}

function dmTitleFromProduct(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  const titleNode = tile.title as Record<string, unknown> | undefined;
  const brand = firstBrand(
    product.brandName || (tile.brand as Record<string, unknown> | undefined)?.name
  );
  const title = cleanText(product.title || titleNode?.tileHeadline || "");
  return cleanText(`${brand} ${title}`);
}

function pickDmProduct(
  products: Record<string, unknown>[],
  code: string,
  name: string
) {
  if (code) {
    const exact = products.find((item) => {
      const tile = (item.tileData as Record<string, unknown> | undefined) || {};
      return codesMatch(String(item.gtin || tile.gtin || ""), code);
    });
    if (exact) return exact;
  }
  if (!name) return null;
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;
  for (const product of products) {
    const title = dmTitleFromProduct(product);
    const score = wordOverlap(name, title);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

async function hitFromDmProduct(
  product: Record<string, unknown> | null,
  withIngredients = false
): Promise<CatalogHit | null> {
  if (!product) return null;
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  const titleNode = tile.title as Record<string, unknown> | undefined;
  const name = cleanText(product.title || titleNode?.tileHeadline || "");
  const brand = firstBrand(
    product.brandName || (tile.brand as Record<string, unknown> | undefined)?.name
  );
  const size = extractSize(name, product.title);
  let ingredients = "";
  const self = cleanText(tile.self || "");
  if (withIngredients && self.startsWith("/")) {
    const markdown = await fetchMarkdown(`https://www.dm.de${self}`, 8000);
    ingredients = ingredientsFromMarkdown(markdown);
  }
  return drugstoreHit(name, brand, size, ingredients, "", dmPriceFromProduct(product));
}

async function lookupDm(code: string): Promise<CatalogHit | null> {
  const products = await fetchDmSearch(code);
  const product = pickDmProduct(products, code, "");
  return hitFromDmProduct(product, true);
}

async function lookupDmByName(name: string, code = "") {
  const products = await fetchDmSearch(name.slice(0, 90));
  return hitFromDmProduct(pickDmProduct(products, code, name), false);
}

function pricesFromRecord(value: unknown, depth = 0): number[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return euroPricesFromText(value, true);
  if (typeof value === "number") return [];
  if (Array.isArray(value)) {
    return value.slice(0, 40).flatMap((item) => pricesFromRecord(item, depth + 1));
  }
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const out: number[] = [];
  const currency = String(row.currency || row.price_currency || row.priceCurrency || "");
  const rawPrice = row.price ?? row.amount ?? row.value ?? row.lowPrice ?? row.lowest;
  if (rawPrice != null && /EUR|€/i.test(currency || String(rawPrice))) {
    const n = parseEuroAmount(rawPrice);
    if (n >= 0.15 && n < 5000) out.push(n);
  }
  for (const [key, child] of Object.entries(row)) {
    if (!/price|preis|amount|offer/i.test(key)) continue;
    if (/USD|GBP|JPY/i.test(currency) && !/EUR/i.test(currency)) continue;
    out.push(...pricesFromRecord(child, depth + 1));
  }
  return out;
}

async function priceFromMarkdownUrl(url: string, code: string, name: string) {
  const page = await fetchMarkdown(url, 7000);
  if (!page || isChallengeHtml(page)) return 0;
  if (code && !htmlHasBarcode(page, code) && name) {
    if (wordOverlap(name, page.slice(0, 1000)) < 0.28) return 0;
  }
  return euroPriceFromText(page, /idealo|geizhals|billiger|google/i.test(url));
}

async function priceFromShopWeb(code: string, name: string) {
  const shortName = cleanText(name).slice(0, 70);
  const hosts = [
    "dm.de",
    "hornbach.de",
    "rossmann.de",
    "obi.de",
    "bauhaus.info",
    "mueller.de",
    "lidl.de",
    "aldi-sued.de",
    "otto.de",
    "kaufland.de",
  ];
  const queries = [
    ...hosts.map((host) => (code ? `"${code}" site:${host}` : "")),
    shortName ? `${shortName} site:dm.de` : "",
    shortName && code ? `${shortName} ${code} €` : "",
  ].filter(Boolean);
  const found = await Promise.all(
    queries.slice(0, 10).map(async (query) => {
      const markdown = await fetchMarkdown(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`,
        7000
      );
      if (!markdown || isChallengeHtml(markdown)) return 0;
      const urls: string[] = [];
      for (const match of markdown.matchAll(/\((https?:[^)]+)\)/g)) {
        const url = decodeSearchUrl(match[1]) || match[1];
        if (!/^https?:/i.test(url) || isShopSearchUrl(url)) continue;
        if (
          !/dm\.de|hornbach\.de|rossmann\.de|obi\.de|bauhaus\.info|mueller\.de|lidl\.de|aldi|otto\.de|kaufland\.de/i.test(
            url
          )
        ) {
          continue;
        }
        if (!urls.includes(url)) urls.push(url);
        if (urls.length >= 2) break;
      }
      const pagePrices = await Promise.all(
        urls.map((url) => priceFromMarkdownUrl(url, code, shortName))
      );
      const snippet = euroPriceFromText(markdown);
      return pickEuroPrice([...pagePrices, snippet].filter((n) => n > 0));
    })
  );
  return pickEuroPrice(found.filter((n) => n > 0));
}

async function lookupComparePrice(code: string, name: string) {
  const q = encodeURIComponent(code || name.slice(0, 70));
  if (!q) return 0;
  const pages = await Promise.all([
    fetchMarkdown(`https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=${q}`, 8000),
    fetchMarkdown(`https://www.geizhals.de/?fs=${q}`, 8000),
    fetchMarkdown(`https://www.billiger.de/search?searchstring=${q}`, 8000),
    code
      ? fetchMarkdown(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
            `"${code}" ${name.slice(0, 40)} (idealo OR geizhals) €`
          )}&kl=de-de`,
          7000
        )
      : Promise.resolve(""),
  ]);
  const amounts: number[] = [];
  for (const page of pages) {
    if (!page || isChallengeHtml(page)) continue;
    if (code && !htmlHasBarcode(page, code) && name) {
      if (wordOverlap(name, page.slice(0, 1200)) < 0.25) continue;
    }
    amounts.push(...euroPricesFromText(page, true));
  }
  return pickEuroPrice(amounts);
}

async function priceFromOpenPrices(code: string) {
  if (!code) return 0;
  const json = await fetchJson(
    `https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(code)}&size=30`,
    6000
  );
  const rows =
    (json?.items as Record<string, unknown>[]) ||
    (json?.results as Record<string, unknown>[]) ||
    [];
  const amounts: number[] = [];
  for (const row of rows) {
    const currency = String(row.currency || "");
    if (currency && !/EUR/i.test(currency)) continue;
    const n = parseEuroAmount(row.price ?? row.amount);
    if (n >= 0.15 && n < 5000) amounts.push(n);
  }
  return pickEuroPrice(amounts);
}

async function priceFromOffProduct(code: string) {
  if (!code) return 0;
  const jsons = await Promise.all(
    OFF_HOSTS.slice(0, 4).map((host) =>
      fetchJson(`${host}/api/v2/product/${encodeURIComponent(code)}.json`, 4000)
    )
  );
  const amounts: number[] = [];
  for (const json of jsons) {
    const product = json?.product as Record<string, unknown> | undefined;
    if (!product) continue;
    amounts.push(...pricesFromRecord(product));
  }
  return pickEuroPrice(amounts);
}

async function priceFromUpcItemDb(code: string) {
  if (!code) return 0;
  const json = await fetchJson(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,
    4000
  );
  const amounts: number[] = [];
  for (const item of (json?.items as Record<string, unknown>[]) || []) {
    for (const offer of (item.offers as Record<string, unknown>[]) || []) {
      const currency = String(offer.currency || "");
      if (currency && !/EUR/i.test(currency)) continue;
      if (!currency) continue;
      const n = parseEuroAmount(offer.price);
      if (n >= 0.15 && n < 5000) amounts.push(n);
    }
  }
  return pickEuroPrice(amounts);
}

async function priceFromIcecat(code: string) {
  if (!code) return 0;
  const json = await fetchJson(
    `https://live.icecat.biz/api/?UserName=openIcecat-live&Language=de&GTIN=${encodeURIComponent(code)}`,
    4000
  );
  return pickEuroPrice(pricesFromRecord(json));
}

async function priceFromGoUpcPage(code: string) {
  if (!code) return 0;
  const html = await fetchHtml(`https://go-upc.com/search?q=${encodeURIComponent(code)}`, 4500);
  if (!html) return 0;
  return jsonLdProduct(html).priceEur || euroPriceFromText(html);
}

async function priceFromCodecheck(code: string, name: string) {
  if (!code && !name) return 0;
  const q = encodeURIComponent(code || name.slice(0, 60));
  return priceFromMarkdownUrl(`https://www.codecheck.info/product.search?q=${q}`, code, name);
}

async function priceFromEanSearch(code: string) {
  const token = (process.env.EAN_SEARCH_API_TOKEN || process.env.EAN_SEARCH_TOKEN || "").trim();
  if (!token || !code) return 0;
  const json = await fetchJson(
    `https://api.ean-search.org/api?token=${encodeURIComponent(token)}&op=barcode-lookup&ean=${encodeURIComponent(code)}&format=json`,
    5000
  );
  const rows = Array.isArray(json) ? json : json ? [json] : [];
  return pickEuroPrice(rows.flatMap((row) => pricesFromRecord(row)));
}

async function priceFromRetailSearch(code: string, name: string) {
  const q = code || name.slice(0, 70);
  if (!q) return 0;
  const pages = await Promise.all([
    fetchMarkdown(`https://www.otto.de/suche/${encodeURIComponent(q)}/`, 7000),
    fetchMarkdown(`https://www.kaufland.de/item/search/?search_value=${encodeURIComponent(q)}`, 7000),
    fetchMarkdown(`https://www.amazon.de/s?k=${encodeURIComponent(q)}`, 7000),
    fetchMarkdown(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${q}" (€ OR EUR) (Preis OR price)`)}&kl=de-de`,
      7000
    ),
  ]);
  const amounts: number[] = [];
  for (const page of pages) {
    if (!page || isChallengeHtml(page)) continue;
    amounts.push(...euroPricesFromText(page, true));
  }
  return pickEuroPrice(amounts);
}

async function findEuroPrice(code: string, name: string) {
  const shortName = cleanText(name);
  const dmQueries = [
    code,
    shortName,
    shortName ? shortName.split(/\s+/).slice(0, 6).join(" ") : "",
  ].filter((query, index, all) => query && all.indexOf(query) === index);
  const results = await Promise.allSettled([
    ...dmQueries.map((query) => lookupDmByName(query, code)),
    priceFromShopWeb(code, shortName),
    lookupComparePrice(code, shortName),
    priceFromOpenPrices(code),
    priceFromOffProduct(code),
    priceFromUpcItemDb(code),
    priceFromIcecat(code),
    priceFromGoUpcPage(code),
    priceFromCodecheck(code, shortName),
    priceFromEanSearch(code),
    priceFromRetailSearch(code, shortName),
  ]);
  const shopAmounts: number[] = [];
  const otherAmounts: number[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (typeof result.value === "number") {
      if (result.value > 0) otherAmounts.push(result.value);
      continue;
    }
    const price = result.value.priceEur || 0;
    if (price > 0) shopAmounts.push(price);
  }
  if (shopAmounts.length) return pickEuroPrice(shopAmounts);
  return pickEuroPrice(otherAmounts);
}

const CLIENT_SHOP_HOSTS = [
  "mueller.de",
  "action.com",
  "lidl.de",
  "aldi-sued.de",
  "aldi-nord.de",
  "primark.com",
  "bauhaus.info",
  "obi.de",
  "hornbach.de",
];

function isClientShopProductUrl(raw: string, host: string) {
  const url = decodeSearchUrl(raw) || raw;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.replace(/^www\./, "").includes(host.replace(/^www\./, ""))) {
      return false;
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || /^\/(de|de-de|en)?$/i.test(path)) return false;
    if (/\/(suche|search|q\/search)(\/|$)/i.test(path) && !/\/p\//i.test(path)) return false;
    if (/sustainab|fibre|fiber|blog|magazine|news|guide|about|help|career/i.test(path)) {
      return false;
    }
    return /\/(p|product|products|artikel)(\/|$)/i.test(path) || /\/p\d+/i.test(path);
  } catch {
    return new RegExp(host.replace(".", "\\.") + ".+\\/(p|product|artikel)", "i").test(url);
  }
}

function hitFromShopPage(page: string, digits: string, fallbackName = ""): CatalogHit | null {
  if (!page || isChallengeHtml(page) || !htmlHasBarcode(page, digits)) return null;
  const pageNames = namesFromMarkdown(page).filter(
    (name) => looksLikeProductName(name) && !isJunkName(name)
  );
  const title = pageNames[0] || fallbackName;
  if (!title || isJunkName(title) || hitLooksWeak(title)) return null;
  const extra = cleanText(page.match(/^[^\n]{20,220}$/m)?.[0] || "");
  return drugstoreHit(
    title,
    firstBrand(title.split(/\s+/)[0]),
    extractSize(title, extra),
    ingredientsFromMarkdown(page),
    isJunkBlurb(extra) || /€|eur|preis/i.test(extra) ? "" : extra,
    euroPriceFromText(page)
  );
}

async function lookupShopHost(code: string, host: string): Promise<CatalogHit | null> {
  const digits = code.replace(/\D/g, "");
  const pages = await Promise.all([
    host === "bauhaus.info"
      ? fetchMarkdown(`https://www.bauhaus.info/suche/produkte?search=${digits}`, 8000)
      : Promise.resolve(""),
    fetchMarkdown(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${digits}" site:${host}`)}&kl=de-de`,
      8000
    ),
  ]);
  const fromSearch = hitFromShopPage(pages[0], digits);
  if (fromSearch) return fromSearch;
  const markdown = pages[1];
  if (!markdown || isChallengeHtml(markdown)) return null;
  const linked: { name: string; url: string }[] = [];
  for (const match of markdown.matchAll(/\[([^\]]{8,160})\]\((https?:[^)]+)\)/g)) {
    const url = decodeSearchUrl(match[2]) || match[2];
    if (!isClientShopProductUrl(url, host)) continue;
    const name = shortItemName(match[1]);
    if (!looksLikeProductName(name)) continue;
    linked.push({ name, url });
  }
  if (!linked.length) return null;
  const first = linked[0];
  const page = await fetchMarkdown(first.url, 8000);
  return hitFromShopPage(page, digits, first.name);
}

async function lookupClientShops(code: string): Promise<CatalogHit[]> {
  return collectHits(CLIENT_SHOP_HOSTS.map((host) => lookupShopHost(code, host)));
}

async function lookupRossmann(code: string): Promise<CatalogHit | null> {
  const digits = code.replace(/\D/g, "");
  const markdownPages = await Promise.all([
    fetchMarkdown(`https://www.rossmann.de/de/p/${digits}`, 8000),
    fetchMarkdown(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${digits}" site:rossmann.de`)}&kl=de-de`,
      8000
    ),
  ]);
  for (const markdown of markdownPages) {
    if (!markdown || isChallengeHtml(markdown)) continue;
    const linked: string[] = [];
    for (const match of markdown.matchAll(/\[([^\]]{8,160})\]\((https?:[^)]+)\)/g)) {
      if (/rossmann\.de\/de\/(?:[^)\s]+\/)?p\/\d+/i.test(match[2])) linked.push(match[1]);
    }
    const names = (linked.length ? linked : namesFromMarkdown(markdown)).filter(
      (name) => looksLikeProductName(name)
    );
    const picked = names[0] || "";
    if (!picked) continue;
    const productUrl = /rossmann\.de\/de\/(?:[^)\s]+\/)?p\/\d+/i.test(markdown);
    if (!productUrl && linked.length === 0) continue;
    const ingredients = ingredientsFromMarkdown(markdown);
    const hit = drugstoreHit(
      picked,
      firstBrand(picked.split(/\s+/)[0]),
      extractSize(picked),
      ingredients,
      "",
      euroPriceFromText(markdown)
    );
    if (hit) return hit;
  }
  return null;
}

async function lookupDatakick(code: string): Promise<CatalogHit | null> {
  const json = await fetchJson(`https://www.datakick.org/api/${encodeURIComponent(code)}`);
  if (!json) return null;
  const found = cleanText(json.gtin || json.ean || json.upc || "");
  if (found && !codesMatch(found, code)) return null;
  const name = cleanText(json.name || json.brand);
  if (isJunkName(name)) return null;
  const brand = firstBrand(json.brand);
  const size = extractSize(json.size, json.weight, name);
  const fullName = specificItemName(name, brand, size);
  return {
    name: fullName,
    description: clearEnglishDescription(
      fullName,
      describeFromParts([
        brand ? `Brand: ${brand}` : "",
        size ? `Size: ${size}` : "",
      ])
    ),
    trusted: true,
  };
}

async function lookupShopSearchResults(url: string, code: string): Promise<CatalogHit[]> {
  const digits = code.replace(/\D/g, "");
  if (!digits) return [];
  const html = (await fetchHtml(url, 8000)) || (await fetchMarkdown(url, 8000));
  if (!html || isChallengeHtml(html) || shopSearchHasNoProduct(html)) return [];
  const productUrls = productUrlsFromShopHtml(html, url);
  if (!productUrls.length) return [];
  const pages = await Promise.all(
    productUrls.slice(0, 2).map((productUrl) => lookupHtmlPage(productUrl, digits))
  );
  const hits = pages.flat().filter((hit) => hit.name && !isJunkName(hit.name));
  return hits;
}

async function lookupHtmlPage(url: string, code = ""): Promise<CatalogHit[]> {
  if (isShopSearchUrl(url)) {
    const shopSearch =
      /dm\.de|rossmann\.de|mueller\.de|lidl\.de|action\.com|aldi-sued|aldi-nord|primark\.com|bauhaus\.info|obi\.de|hornbach\.de/i.test(
        url
      );
    return shopSearch && code ? lookupShopSearchResults(url, code) : [];
  }
  const html = await fetchHtml(url);
  if (!html || lookupMissHtml(html) || isChallengeHtml(html)) {
    if (
      /homelux-shop|merkandi\.com\/(archive|products)|search\?q=|dm\.de|rossmann\.de|mueller\.de|lidl\.de|action\.com|aldi-sued|aldi-nord|primark\.com|bauhaus\.info|obi\.de|hornbach\.de/i.test(
        url
      )
    ) {
      return lookupMarkdownPage(url, code);
    }
    return [];
  }
  const searchPage = /\/(suche|search|q\/search)(\/|\?|$)/i.test(url);
  let names = namesFromHtml(html).filter((name) => looksLikeProductName(name) && !isJunkName(name));
  if (searchPage) {
    names = names.filter(
      (name) => extractSize(name) || name.split(/\s+/).length >= 3
    );
  }
  if (code && !htmlHasBarcode(html, code) && !jsonLdProductName(html)) {
    names = names.filter((name) => looksLikeProductName(name));
  }
  if (searchPage && !jsonLdProductName(html) && names.every((name) => isJunkName(name))) {
    names = [];
  }
  if (!names.length) return [];
  const brand = brandFromHtml(html);
  const size = jsonLdProduct(html).size || sizeFromHtml(html);
  const ingredients = ingredientsFromHtml(html);
  const desc = cleanText(
    html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i)?.[1] ||
      ""
  );
  const trusted = Boolean(jsonLdProductName(html));
  const priceEur = jsonLdProduct(html).priceEur || euroPriceFromText(html);
  return names.map((name) => {
    const fullName = specificItemName(name, brand, size || extractSize(name));
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          brand ? `Brand: ${brand}` : "",
          size ? `Size: ${size}` : "",
          ingredients ? `Ingredients: ${ingredients}` : "",
          isJunkBlurb(desc) ? "" : desc,
        ])
      ),
      trusted,
      priceEur: priceEur > 0 ? priceEur : undefined,
    };
  });
}

async function lookupDuckDuckGo(query: string): Promise<CatalogHit | null> {
  if (/^\d{8,14}$/.test(query.replace(/\D/g, "")) && query.replace(/\D/g, "").length >= 8) {
    return null;
  }
  const json = await fetchJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  );
  if (!json) return null;
  const heading = cleanText(json.Heading);
  const abstract = cleanText(json.AbstractText || json.Abstract);
  if (isJunkName(heading) || !abstract) return null;
  return {
    name: heading,
    description: clearEnglishDescription(heading, abstract),
    trusted: false,
  };
}

function decodeSearchUrl(raw: string) {
  let href = cleanText(raw).replace(/&amp;/g, "&");
  try {
    if (href.includes("uddg=")) {
      href = decodeURIComponent(href.split("uddg=")[1].split("&")[0]);
    }
    const url = new URL(href, "https://duckduckgo.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (
      /duckduckgo|google\.|bing\.|facebook|youtube|twitter|instagram|pinterest|wikipedia/i.test(
        url.hostname
      )
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function collectSearchUrls(html: string) {
  const urls: string[] = [];
  const push = (raw: string) => {
    const url = decodeSearchUrl(raw);
    if (!url) return;
    const key = url.split("?")[0].toLowerCase();
    if (urls.some((item) => item.split("?")[0].toLowerCase() === key)) return;
    urls.push(url);
  };
  for (const match of html.matchAll(/class="result__url"[^>]*>([^<]+)/gi)) {
    push(`https://${cleanText(match[1])}`);
  }
  for (const match of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gi)) {
    push(match[1]);
  }
  for (const match of html.matchAll(/uddg=([^&"]+)/gi)) {
    push(match[1]);
  }
  return urls;
}

function looksLikeProductName(name: string) {
  const text = shortItemName(name);
  if (!text || isJunkName(text)) return false;
  if (!/[a-zäöüß]/i.test(text)) return false;
  const words = text.split(/\s+/).filter((w) => /[a-zäöüß]{2,}/i.test(w));
  return words.length >= 1;
}

function titlesFromSearchHtml(html: string) {
  const titles: string[] = [];
  const push = (raw: string) => {
    const name = shortItemName(cleanText(raw).replace(/<[^>]+>/g, " "));
    if (!looksLikeProductName(name)) return;
    if (titles.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    titles.push(name);
  };
  for (const match of html.matchAll(/class="result__a"[^>]*>([\s\S]{4,180}?)<\/a>/gi)) {
    push(match[1]);
  }
  for (const match of html.matchAll(/<a[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]{4,180}?)<\/a>/gi)) {
    push(match[1]);
  }
  return titles;
}

function namesFromMarkdown(markdown: string) {
  const resultBlock =
    markdown.split(/##\s*\d+\s+Ergebnisse?\b/i)[1] ||
    markdown.split(/#\s*Suchergebnisse\b/i)[1] ||
    markdown;
  const text = resultBlock.split(
    /\n(?:#{1,3}\s+)?(?:Warum |Bestseller|Neu bei|Ähnliche|Related|Weitere Produkte)/i
  )[0];
  const names: string[] = [];
  const push = (raw: string) => {
    const name = shortItemName(
      cleanText(raw)
        .replace(/^Image\s+\d+:\s*/i, "")
        .replace(/^!\[.*?$/g, "")
    );
    if (!looksLikeProductName(name)) return;
    if (/^homelux(?:-shop)?$/i.test(name)) return;
    if (names.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    names.push(name);
  };
  for (const match of text.matchAll(/!\[[^\]]*?:\s*([A-Za-zÄÖÜäöüß][^\]]{7,160})\]/g)) {
    push(match[1]);
  }
  for (const match of text.matchAll(/\[([^\]]{8,160})\]\((https?:[^)]+)\)/g)) {
    const href = match[2];
    if (
      /\/(products?|archive|item|p)\//i.test(href) &&
      !/\/(suche|search)(\/|$|\?)/i.test(href.split("?")[0])
    ) {
      push(match[1]);
    }
  }
  for (const match of text.matchAll(/^#{1,3}\s+\[([^\]]{8,160})\]/gm)) {
    push(match[1]);
  }
  if (/##\s*1\s+Ergebnisse?\b/i.test(markdown)) return names.slice(0, 2);
  return names;
}

function hitsFromNames(names: string[]) {
  const hits: CatalogHit[] = [];
  for (const name of names) {
    const fullName = specificItemName(name);
    if (!fullName || isJunkName(fullName) || isPricedOfferName(fullName)) continue;
    if (hits.some((hit) => hit.name.toLowerCase() === fullName.toLowerCase())) {
      continue;
    }
    hits.push({
      name: fullName,
      description: clearEnglishDescription(fullName),
      trusted: /air fryer|shower gel|shampoo/i.test(fullName),
    });
  }
  return hits;
}

async function lookupMarkdownPage(url: string, code: string): Promise<CatalogHit[]> {
  if (isShopSearchUrl(url) && !/duckduckgo|google\.|bing\./i.test(url)) return [];
  const markdown = await fetchMarkdown(url);
  if (!markdown) return [];
  let names = namesFromMarkdown(markdown);
  const searchEngine = /duckduckgo|google\.|bing\.|yahoo\./i.test(url);
  if (searchEngine && code) {
    names = names.filter((name) => {
      const needle = name.slice(0, 28);
      const idx = markdown.toLowerCase().indexOf(needle.toLowerCase());
      if (idx < 0) return false;
      return htmlHasBarcode(markdown.slice(Math.max(0, idx - 280), idx + 360), code);
    });
  } else if (code && !htmlHasBarcode(markdown, code) && !markdown.includes(code)) {
    names = names.filter((name) => looksLikeProductName(name));
  }
  const hits = hitsFromNames(names);
  const priceEur = euroPriceFromText(markdown);
  if (!(priceEur > 0) || /duckduckgo|google\.|bing\./i.test(url)) return hits;
  return hits.map((hit) => ({ ...hit, priceEur }));
}

async function lookupSearchTitles(code: string): Promise<CatalogHit[]> {
  const queries = webSearchQueries(code).slice(0, 4);
  const pages = await Promise.all(
    queries.map((query) =>
      fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`)
    )
  );
  const hits: CatalogHit[] = [];
  for (const html of pages) {
    for (const name of titlesFromSearchHtml(html)) {
      const fullName = specificItemName(name);
      if (isJunkName(fullName) || isPricedOfferName(fullName)) continue;
      if (hits.some((hit) => hit.name.toLowerCase() === fullName.toLowerCase())) continue;
      hits.push({
        name: fullName,
        description: clearEnglishDescription(fullName),
        trusted: false,
      });
    }
  }
  if (hits.length) return hits.slice(0, 16);
  const markdownHits = await collectHits(
    queries.slice(0, 3).map((query) =>
      lookupMarkdownPage(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`,
        code
      )
    )
  );
  return markdownHits.slice(0, 16);
}

async function lookupWebPages(code: string): Promise<CatalogHit[]> {
  const retail = [
    `https://www.homelux-shop.de/search?q=${encodeURIComponent(code)}`,
  ];
  const searchUrls = webSearchQueries(code)
    .slice(0, 3)
    .map((query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`);
  const markdownHits = await collectHits(
    [...retail, ...searchUrls].map((url) => lookupMarkdownPage(url, code))
  );
  if (markdownHits.length) return markdownHits;
  const pages = await Promise.all(searchUrls.map((url) => fetchHtml(url)));
  const urls = [...new Set(pages.flatMap(collectSearchUrls))];
  return collectHits(urls.slice(0, 8).map((url) => lookupHtmlPage(url, code)));
}

function claudeKey() {
  return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
}

async function askClaude(system: string, user: string, maxTokens = 160) {
  const key = claudeKey();
  if (!key) return "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = json.content?.find((block) => block.type === "text")?.text || "";
    return cleanText(text);
  } catch {
    return "";
  }
}

function parseAiProduct(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { name?: string; description?: string };
    const name = cleanText(parsed.name || "");
    const description = cleanText(parsed.description || "");
    if (isJunkName(name)) return null;
    return { name, description: description || name, trusted: false as const };
  } catch {
    return null;
  }
}

async function identifyWithAi(query: string, kind: "barcode" | "name") {
  const system =
    'You identify retail products for VANO German Store. Prefer an English product name: brand + English type + size (example: "Malizia Shower Gel 150 ml"). Use shower gel, not gel bagno / gel bano / duschgel. Never invent a brand or size. Reply JSON only: {"name":"","description":""}. Description in simple English. No prices. If unsure, empty strings.';
  const user =
    kind === "barcode"
      ? `What product has EAN/GTIN ${query}? Give a clear product name and an English description.`
      : `Clear product name and English description for: ${query}`;

  const claude = parseAiProduct(await askClaude(system, user, 160));
  if (claude) return claude;

  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 160,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseAiProduct(json.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}

function mergeHits(values: Array<CatalogHit | CatalogHit[] | null | undefined>) {
  const hits: CatalogHit[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const list = Array.isArray(value) ? value : [value];
    for (const hit of list) {
      if (!hit?.name) continue;
      const shortName = shortItemName(hit.name);
      if (!shortName || isJunkName(shortName)) continue;
      const brand = firstBrand(labeledValue(hit.description, "Brand"));
      const size =
        extractSize(shortName, hit.description) || labeledValue(hit.description, "Size");
      const fullName = specificItemName(shortName, brand, size);
      const normalized = {
        name: fullName,
        description: clearEnglishDescription(
          fullName,
          describeFromParts([
            brand ? `Brand: ${brand}` : "",
            size ? `Size: ${size}` : "",
            hit.description,
          ])
        ),
        trusted: Boolean(hit.trusted),
        priceEur: hit.priceEur && hit.priceEur > 0 ? hit.priceEur : undefined,
      };
      const key = normalized.name.toLowerCase();
      if (seen.has(key)) {
        const existing = hits.find((row) => row.name.toLowerCase() === key);
        if (existing && !existing.priceEur && normalized.priceEur) {
          existing.priceEur = normalized.priceEur;
        }
        continue;
      }
      seen.add(key);
      hits.push(normalized);
    }
  }
  hits.sort((a, b) => germanScore(b) - germanScore(a));
  const unique: CatalogHit[] = [];
  for (const hit of hits) {
    if (unique.some((other) => wordOverlap(other.name, hit.name) >= 0.55)) continue;
    unique.push(hit);
    if (unique.length >= 4) break;
  }
  return unique;
}

async function collectHits(jobs: Array<Promise<CatalogHit | null | undefined | CatalogHit[]>>) {
  const results = await Promise.allSettled(jobs);
  return mergeHits(results.map((result) => (result.status === "fulfilled" ? result.value : null)));
}

async function collectHitsFast(
  jobs: Array<Promise<CatalogHit | null | undefined | CatalogHit[]>>,
  waitMs = 2400,
  extraMs = 400,
  needStrong = false
) {
  const values: Array<CatalogHit | CatalogHit[] | null | undefined> = [];
  let remaining = jobs.length;
  return await new Promise<CatalogHit[]>((resolve) => {
    let finished = false;
    let extraTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (extraTimer) clearTimeout(extraTimer);
      resolve(mergeHits(values));
    };
    const cap = setTimeout(finish, waitMs);
    for (const job of jobs) {
      Promise.resolve(job)
        .then((value) => {
          values.push(value);
          const hits = mergeHits(values);
          const ready = needStrong ? hitsAreStrong(hits) : hits.length > 0;
          if (ready && !extraTimer) {
            extraTimer = setTimeout(() => {
              clearTimeout(cap);
              finish();
            }, extraMs);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearTimeout(cap);
            finish();
          }
        });
    }
  });
}

function ensureLookupCache() {
  localDb().exec(
    `CREATE TABLE IF NOT EXISTS barcode_lookups (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      matches_json TEXT,
      updated_at TEXT
    )`
  );
}

function recallLookupCache(barcode: string): CatalogHit[] {
  try {
    ensureLookupCache();
    const digits = barcode.replace(/\D/g, "");
    const row = localDb()
      .prepare(
        `SELECT name, description, matches_json FROM barcode_lookups
         WHERE code = ? OR code = ? LIMIT 1`
      )
      .get(digits, digits.replace(/^0+/, "")) as
      | { name?: string; description?: string; matches_json?: string }
      | undefined;
    if (!row?.name) return [];
    let matches: CatalogHit[] = [];
    try {
      matches = JSON.parse(row.matches_json || "[]") as CatalogHit[];
    } catch {
      matches = [];
    }
    if (!matches.length) {
      matches = [{ name: row.name, description: row.description || "", trusted: true }];
    }
    return matches.filter((hit) => hit.name && !isJunkName(hit.name));
  } catch {
    return [];
  }
}

function rememberLookupCache(barcode: string, hits: CatalogHit[]) {
  if (!hits.length) return;
  try {
    ensureLookupCache();
    const digits = barcode.replace(/\D/g, "");
    localDb()
      .prepare(
        `INSERT INTO barcode_lookups (code, name, description, matches_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           matches_json = excluded.matches_json,
           updated_at = excluded.updated_at`
      )
      .run(
        digits,
        hits[0].name,
        hits[0].description || "",
        JSON.stringify(hits.slice(0, 24)),
        new Date().toISOString()
      );
  } catch {
    /* cache is optional */
  }
}

function lookupLocalBarcode(barcode: string): CatalogHit[] {
  try {
    const hits: CatalogHit[] = [];
    for (const code of barcodeVariants(barcode).slice(0, 3)) {
      for (const product of searchCatalog(code)) {
        if (!product.barcode || !codesMatch(String(product.barcode), barcode)) continue;
        const name = cleanText(product.name);
        if (!name || isJunkName(name)) continue;
        hits.push({
          name,
          description: clearEnglishDescription(name, product.description || ""),
          trusted: true,
        });
      }
    }
    return hits;
  } catch {
    return [];
  }
}

function hitFromWeb(web: WebProduct | null): CatalogHit | null {
  if (!web?.name || isJunkName(web.name) || hitLooksWeak(web.name)) return null;
  return {
    name: web.name,
    description: web.description || web.name,
    trusted: web.confident,
    priceEur: web.priceEur,
  };
}

async function lookupBarcode(barcode: string) {
  const codes = barcodeVariants(barcode);
  const main = codes[0];
  if (!main) return [];
  const dmPromise = lookupDm(main);

  async function withShopPrice(hits: CatalogHit[]) {
    if (hits.some((hit) => hit.priceEur && hit.priceEur > 0)) return hits;
    const dm = await dmPromise;
    const priceEur = dm?.priceEur;
    if (!(priceEur && priceEur > 0)) {
      if (!hits.length && dm) return [dm];
      return hits;
    }
    const base = hits.length ? hits : [dm];
    return base.map((hit) => ({ ...hit, priceEur: hit.priceEur || priceEur }));
  }

  const cached = recallLookupCache(main).filter((hit) => !hitLooksWeak(hit.name));
  if (cached.length) {
    const priced = await withShopPrice(cached);
    rememberLookupCache(main, priced);
    return priced;
  }

  const local = lookupLocalBarcode(main);
  if (local.length) {
    const priced = await withShopPrice(local);
    rememberLookupCache(main, priced);
    return priced;
  }

  const lang = gs1Language(main);
  const chinaCode = /^69/.test(main.replace(/^0+/, ""));
  const fast = await collectHitsFast(
    [
      lookupBarcodepedia(main),
      lookupOpenFactsCode(main),
      lookupIcecat(main, lang),
      lookupIcecat(main, "en"),
      lookupDatakick(main),
      lookupGoUpc(main),
      lookupUpcItemDb(main),
      dmPromise,
      lookupRossmann(main),
      lookupClientShops(main),
      ...catalogPagesFor(main)
        .slice(0, chinaCode ? 8 : 10)
        .map((url) => lookupHtmlPage(url, main)),
      ...(chinaCode ? [lookupWebPages(main), lookupSearchTitles(main)] : []),
    ],
    chinaCode ? 12000 : 7000,
    chinaCode ? 1500 : 1000,
    true
  );
  let hits = fast;

  if (!hits.length) {
    // Scrapers and a live Claude web search run side by side; a confirmed web hit wins.
    const [scraped, web] = await Promise.all([
      collectHitsFast([lookupWebPages(main), lookupSearchTitles(main)], 14000, 800),
      lookupBarcodeOnWeb(main),
    ]);
    const webHit = hitFromWeb(web);
    // mergeHits ranks trusted (barcode-confirmed) hits first.
    hits = webHit ? mergeHits([webHit, scraped]) : scraped;
  } else if (!hits.some((hit) => hit.trusted)) {
    // Only unconfirmed names (page titles that merely mention the number): check the web
    // for a page that really shows this barcode, and let a confirmed result win.
    const webHit = hitFromWeb(await lookupBarcodeOnWeb(main, hits[0]?.name || ""));
    if (webHit?.trusted) hits = mergeHits([webHit, hits]);
    else if (webHit) hits = mergeHits([hits, webHit]);
  }
  if (!hits.length) {
    const ai = await identifyWithAi(main, "barcode");
    if (ai && !hitLooksWeak(ai.name)) hits = [ai];
  }
  const usable = await withShopPrice(hits.filter((hit) => !hitLooksWeak(hit.name)));
  if (usable.length) rememberLookupCache(main, usable);
  return usable;
}

async function searchByName(name: string) {
  const q = encodeURIComponent(name);
  const hosts = [
    "https://de.openfoodfacts.org",
    "https://world.openfoodfacts.org",
    "https://de.openproductsfacts.org",
    "https://world.openproductsfacts.org",
  ];
  const hits = await collectHitsFast(
    hosts.map((host) =>
      fetchJson(
        `${host}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=5`
      ).then((json) =>
        ((json?.products as Record<string, unknown>[]) || []).flatMap((product) =>
          hitFromOffProduct(product)
        )
      )
    ),
    2000,
    200
  );
  if (hits.length) return hits;
  const extra = await collectHitsFast([lookupDuckDuckGo(name)], 2000, 150);
  if (extra.length) return extra;
  const ai = await identifyWithAi(name, "name");
  return ai ? [ai] : [];
}

async function describeWithAi(name: string, extra = "") {
  const system =
    "Write 3 or 4 short simple English sentences for a shop item card, the same style as a filled existing item. Say what the item is, the brand, the pack size, scent or taste if it is on the name, and how to use or store it. If known details include ingredients, keep an Ingredients: line with those names. Easy words. No prices, no hashtags, no website names. Do not invent ingredients.";
  const user = extra
    ? `Product name: ${name}\nKnown details: ${extra}`
    : `Product name: ${name}`;
  const claude = await askClaude(system, user, 180);
  if (claude) return claude;
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return "";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return cleanText(json.choices?.[0]?.message?.content || "");
  } catch {
    return "";
  }
}

export async function lookupProduct(input: { barcode?: string; name?: string }) {
  const barcode = extractProductCode(input.barcode || "");
  const typedName = cleanText(input.name || "");
  let matches: CatalogHit[] = [];

  if (barcode) {
    // An 8-digit code can be EAN-8 or a UPC-E (catalogs list UPC-E under its 12-digit UPC-A).
    const upcA = expandUpcE(barcode);
    if (upcA && !isValidGtin(barcode)) {
      matches = await lookupBarcode(upcA);
    } else {
      matches = await lookupBarcode(barcode);
      if (!matches.length && upcA) matches = await lookupBarcode(upcA);
    }
  }
  if (matches.length === 0 && typedName && !barcode) matches = await searchByName(typedName);

  const cleanedMatches = (
    await Promise.all(
      matches
        .filter((match) => !isJunkName(match.name) && !hitLooksWeak(match.name))
        .slice(0, 24)
        .map(async (match) => {
          const brand = labeledValue(match.description, "Brand");
          const size =
            extractSize(match.name, match.description) || labeledValue(match.description, "Size");
          const name = await englishShopName(match.name, brand, size);
          return {
            ...match,
            name,
            description: uniqueSentences(
              clearEnglishDescription(name, match.description).split(/(?<=[.!?])\s+/)
            ),
          };
        })
    )
  ).filter((match) => match.name && !isJunkName(match.name));
  const trusted = cleanedMatches.filter((match) => match.trusted);
  const englishName = (item: CatalogHit) =>
    !looksGerman(item.name) &&
    /\b(shower gel|shampoo|conditioner|toothpaste|cream|deodorant|soap|oil|lotion|mineral water|carbonated|air fryer|coffee grinder|coffee machine|kettle|lip balm|hex bolt|wood screw|universal screw|mouthwash|ice cube|silicone|panel radiator|radiator)\b/i.test(
      item.name
    ) &&
    !hitLooksWeak(item.name);
  const hit =
    trusted.find(englishName) ||
    cleanedMatches.find(englishName) ||
    cleanedMatches.find((item) => !looksGerman(item.name)) ||
    trusted[0] ||
    cleanedMatches[0] ||
    null;
  const name = hit?.name || typedName;
  let description = hit?.description || "";
  const ingredients =
    ingredientsFromText(description) ||
    cleanedMatches.map((match) => ingredientsFromText(match.description)).find(Boolean) ||
    "";
  if (name) {
    const extra = describeFromParts([
      description,
      ingredients ? `Ingredients: ${ingredients}` : "",
    ]);
    const aiDesc = await describeWithAi(name, extra);
    description = uniqueSentences(
      clearEnglishDescription(name, describeFromParts([aiDesc, extra])).split(
        /(?<=[.!?])\s+/
      )
    );
  }
  let priceEur =
    (hit?.priceEur && hit.priceEur > 0 ? hit.priceEur : 0) ||
    cleanedMatches.find((match) => match.priceEur && match.priceEur > 0)?.priceEur ||
    0;
  if (!(priceEur > 0) && (barcode || name)) {
    priceEur = await findEuroPrice(barcode, name);
    if (!(priceEur > 0) && barcode) {
      // Shops and price sites missed: let Claude search the web for this barcode's price.
      const web = await lookupBarcodeOnWeb(barcode, name);
      priceEur = web?.priceEur || 0;
    }
    if (priceEur > 0) {
      if (hit) hit.priceEur = priceEur;
      for (const match of cleanedMatches) {
        if (!match.priceEur) match.priceEur = priceEur;
      }
    }
  }
  if (barcode && cleanedMatches.length) rememberLookupCache(barcode, cleanedMatches);
  return {
    name: hit?.name || "",
    description:
      typedName && !hit
        ? uniqueSentences(
            clearEnglishDescription(
              typedName,
              await describeWithAi(typedName)
            ).split(/(?<=[.!?])\s+/)
          )
        : description,
    matches: cleanedMatches,
    found: cleanedMatches.length > 0,
    priceEur: priceEur > 0 ? priceEur : undefined,
  };
}
