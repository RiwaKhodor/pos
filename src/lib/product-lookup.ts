const UA = "VANO-POS/0.1.19 (store product lookup)";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CatalogHit = {
  name: string;
  description: string;
  trusted?: boolean;
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

function withSizeInName(name: string, size: string) {
  if (!name || !size) return name;
  const compact = name.toLowerCase().replace(/\s+/g, "");
  if (compact.includes(size.toLowerCase().replace(/\s+/g, ""))) return name;
  if (extractSize(name)) return name;
  return `${name} ${size}`;
}

function shortItemName(name: string) {
  let text = cleanText(name);
  text = text.replace(
    /\s*[|\-–—]\s*(go-upc|upcitemdb|buycott|barcode.?lookup|codecheck|open food facts|ean.?search|wikipedia).*$/i,
    ""
  );
  text = text.replace(/\b(ean|gtin|upc|isbn)[:\s-]*\d{8,14}\b/gi, "");
  text = text.replace(/\b\d{12,14}\b/g, "");
  const dashParts = text.split(/\s+[–—-]\s+/).map((part) => part.trim()).filter(Boolean);
  if (dashParts.length > 2) text = `${dashParts[0]} ${dashParts[1]}`.trim();
  const commaParts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 2) text = commaParts[0];
  text = cleanText(text);
  if (text.length > 70) {
    text = text.slice(0, 70).replace(/\s+\S*$/, "").trim();
  }
  return text;
}

function labeledValue(raw: string, label: string) {
  return cleanText(raw.match(new RegExp(`${label}:\\s*([^.]*)`, "i"))?.[1] || "");
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
    [/\b(duschgel|shower gel)\b/, "a shower gel"],
    [/\b(seife|soap)\b/, "a soap"],
    [/\b(zahnpasta|toothpaste)\b/, "a toothpaste"],
    [/\b(waschmittel|laundry detergent|detergent)\b/, "a laundry detergent"],
    [/\b(spülmittel|spuelmittel|dishwashing)\b/, "a dishwashing liquid"],
    [/\b(kaffee|coffee)\b/, "a coffee product"],
    [/\b(tee|tea)\b/, "a tea"],
    [/\b(saft|juice)\b/, "a juice drink"],
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
  if (/coffee|tea|juice|milk|water|drink|getränk/.test(text)) {
    return "Serve as written on the pack.";
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

function isJunkBlurb(text: string) {
  const t = cleanText(text);
  if (!t) return true;
  if (/ean finder|suchen, validieren|produktcode|recherche de produits|ean-suche/i.test(t)) {
    return true;
  }
  return t.length < 90 && isJunkName(t);
}

export function clearEnglishDescription(name: string, raw = "") {
  const product = cleanText(name).replace(/\.$/, "");
  if (!product) return "";
  let extra = cleanText(raw);
  if (extra.toLowerCase() === product.toLowerCase() || isJunkBlurb(extra)) extra = "";

  const extraSentences = extra
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (extraSentences.length >= 2 && extra.length > product.length + 24) {
    return uniqueSentences(extraSentences).slice(0, 520);
  }

  const brand = labeledValue(extra, "Brand");
  const size =
    labeledValue(extra, "Size") ||
    cleanText(extra.match(/\b\d+[\d.,]*\s*(ml|l|cl|g|kg|oz|pcs|stück|pack)\b/i)?.[0] || "");
  const category = cleanCategory(labeledValue(extra, "Category"));
  let notes = extra
    .replace(/Brand:\s*[^.]*\.?/gi, " ")
    .replace(/Size:\s*[^.]*\.?/gi, " ")
    .replace(/Category:\s*[^.]*\.?/gi, " ")
    .replace(new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ")
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (isJunkBlurb(notes) || notes.length < 8) notes = "";
  if (brand && notes.toLowerCase().includes(brand.toLowerCase())) {
    notes = notes.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  if (size && notes.toLowerCase().includes(size.toLowerCase())) {
    notes = notes.replace(new RegExp(size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  notes = cleanText(notes);

  const kind = guessKind(`${product} ${category} ${notes}`);
  const sentences: string[] = [];

  if (kind) sentences.push(`${product} is ${kind}.`);
  else if (category) sentences.push(`${product} is a ${category.toLowerCase()} item.`);
  else sentences.push(`${product} is a shop pack.`);

  if (brand && !product.toLowerCase().includes(brand.toLowerCase())) {
    sentences.push(`The brand is ${brand}.`);
  }

  const packSize = size || extractSize(product, extra);
  if (packSize) {
    sentences.push(`The pack size is ${packSize}.`);
  }

  if (notes && notes.length > 12) {
    const note = notes.charAt(0).toUpperCase() + notes.slice(1);
    sentences.push(note);
  }

  const use = guessUse(product, kind, category);
  if (use) sentences.push(use);

  return uniqueSentences(sentences).slice(0, 520);
}

function germanScore(hit: CatalogHit) {
  const text = `${hit.name} ${hit.description}`;
  let score = 40 - Math.abs(hit.name.length - 32);
  if (hit.trusted) score += 80;
  if (/[äöüÄÖÜß]/.test(text) || /\b(the|and|with|ml|pack)\b/i.test(text)) score += 20;
  if (
    /\b(ml|g|kg|l|cl|Liter|Stück|Packung|Waschmittel|Shampoo|Drogerie|Bio)\b/i.test(
      text
    )
  ) {
    score += 25;
  }
  if ((hit.name.match(/,/g) || []).length > 1) score -= 50;
  if (/\b(ean|upc|gtin|suche|search|recherche)\b/i.test(hit.name)) score -= 80;
  return score;
}

function htmlHasBarcode(html: string, code: string) {
  const digits = code.replace(/\D/g, "");
  if (!html || digits.length < 8) return false;
  const stripped = digits.replace(/^0+/, "") || digits;
  return html.includes(digits) || html.includes(stripped);
}

function codesMatch(found: string, expected: string) {
  const a = found.replace(/\D/g, "").replace(/^0+/, "");
  const b = expected.replace(/\D/g, "").replace(/^0+/, "");
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

function lookupMissHtml(html: string) {
  const title = `${html.match(/<title[^>]*>\s*([^<]+)/i)?.[1] || ""} ${
    html.match(/<h1[^>]*>\s*([^<]+)/i)?.[1] || ""
  }`;
  return /product not found|no product found|we couldn['’]t find|keine treffer|nicht gefunden|no item found/i.test(
    title
  );
}

function isJunkName(name: string) {
  const text = shortItemName(name) || name.trim();
  if (!text || text.length < 3 || text.length > 90) return true;
  if (/\?/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (/\b(ean|upc|isbn|gtin)\b/i.test(text) && /search|suche|recherche|lookup|database|datenbank/i.test(text)) {
    return true;
  }
  return /ean-?suche|ean-?search|ean finder|open ean|suchergebnisse|welches produkt|steckt hinter|datenbank|produktbewertung|validieren|generieren|produktcode|suche:|recherche|produits|par ean|barcode lookup|upc lookup|not found|404|search results|look\s*up|duckduckgo|wikipedia|buycott|itemdb|home page|codecheck|barcoo|openean|gtin db|retail product|mid-tower|atx,/i.test(
    text
  );
}

function flattenLd(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenLd);
  if (typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...flattenLd(node["@graph"])];
}

function jsonLdProductName(html: string) {
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
        if (!isJunkName(name)) return name;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
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
    product.product_name_de,
    product.product_name_en,
    product.product_name,
    product.generic_name_de,
    product.generic_name_en,
    product.generic_name,
  ]
    .map(cleanText)
    .filter((name, index, list) => name && list.indexOf(name) === index && !isJunkName(name));
  const size = extractSize(
    product.quantity,
    product.product_quantity != null
      ? `${product.product_quantity} ${product.product_quantity_unit || ""}`
      : "",
    product.serving_size,
    ...names
  );
  return names.map((name) => {
    const fullName = withSizeInName(name, size);
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          product.generic_name_en || product.generic_name_de || product.generic_name,
          product.brands ? `Brand: ${cleanText(product.brands)}` : "",
          size ? `Size: ${size}` : "",
          product.categories ? `Category: ${cleanCategory(cleanText(product.categories))}` : "",
        ])
      ),
      trusted: true,
    };
  });
}

async function fetchJson(url: string, timeoutMs = 8000) {
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

async function fetchHtml(url: string, timeoutMs = 8000) {
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
    if (!res.ok) return "";
    return await res.text();
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

async function lookupOpenFactsCode(code: string): Promise<CatalogHit[]> {
  const jobs = OFF_HOSTS.flatMap((host) => [
    fetchJson(`${host}/api/v2/product/${encodeURIComponent(code)}.json`).then((json) => {
      if (!json) return null;
      if (json.status !== 1 && json.status !== "success") return null;
      return hitFromOffProduct(json.product as Record<string, unknown>, code);
    }),
    fetchJson(
      `${host}/api/v2/search?code=${encodeURIComponent(code)}&page_size=8&fields=code,product_name,product_name_de,product_name_en,generic_name,generic_name_de,generic_name_en,brands,quantity,product_quantity,product_quantity_unit,serving_size,ingredients_text,ingredients_text_en,categories`
    ).then((json) =>
      ((json?.products as Record<string, unknown>[]) || []).flatMap((product) =>
        hitFromOffProduct(product, code)
      )
    ),
    fetchJson(
      `${host}/cgi/search.pl?action=process&json=1&page_size=8&code=${encodeURIComponent(code)}`
    ).then((json) =>
      ((json?.products as Record<string, unknown>[]) || []).flatMap((product) =>
        hitFromOffProduct(product, code)
      )
    ),
  ]);
  return collectHits(jobs);
}

async function lookupGoUpc(code: string): Promise<CatalogHit | null> {
  const html = await fetchHtml(`https://go-upc.com/search?q=${encodeURIComponent(code)}`);
  if (!html || lookupMissHtml(html)) return null;
  const name = nameFromHtml(html);
  if (!name) return null;
  const size = sizeFromHtml(html) || extractSize(name);
  const fullName = withSizeInName(name, size);
  return {
    name: fullName,
    description: clearEnglishDescription(
      fullName,
      describeFromParts([
        tableValue(html, "Category")
          ? `Category: ${tableValue(html, "Category")}`
          : "",
        tableValue(html, "Brand")
          ? `Brand: ${tableValue(html, "Brand")}`
          : "",
        size ? `Size: ${size}` : "",
        tableValue(html, "Description"),
      ])
    ),
    trusted: Boolean(jsonLdProductName(html)),
  };
}

async function lookupUpcItemDb(code: string): Promise<CatalogHit[]> {
  const json = await fetchJson(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
  );
  const items = (json?.items as Record<string, unknown>[]) || [];
  return items
    .map((item) => {
      const foundCode = cleanText(item.upc || item.ean || item.gtin || "");
      if (foundCode && !codesMatch(foundCode, code)) return null;
      const name = cleanText(item.title || item.description);
      if (isJunkName(name)) return null;
      const size = extractSize(item.size, item.dimension, item.description, name);
      const fullName = withSizeInName(name, size);
      return {
        name: fullName,
        description: clearEnglishDescription(
          fullName,
          describeFromParts([
            item.category ? `Category: ${cleanText(item.category)}` : "",
            item.brand ? `Brand: ${cleanText(item.brand)}` : "",
            size ? `Size: ${size}` : "",
            cleanText(item.description),
          ])
        ),
        trusted: true,
      };
    })
    .filter((hit): hit is CatalogHit => Boolean(hit));
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
  const fullName = withSizeInName(name, iceSize);
  const brand = cleanText(
    (info.Brand as Record<string, unknown> | undefined)?.Name || info.Brand
  );
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

async function lookupDatakick(code: string): Promise<CatalogHit | null> {
  const json = await fetchJson(`https://www.datakick.org/api/${encodeURIComponent(code)}`);
  if (!json) return null;
  const found = cleanText(json.gtin || json.ean || json.upc || "");
  if (found && !codesMatch(found, code)) return null;
  const name = cleanText(json.name || json.brand);
  if (isJunkName(name)) return null;
  const size = extractSize(json.size, json.weight, name);
  const fullName = withSizeInName(name, size);
  return {
    name: fullName,
    description: clearEnglishDescription(
      fullName,
      describeFromParts([
        json.brand ? `Brand: ${cleanText(json.brand)}` : "",
        size ? `Size: ${size}` : "",
      ])
    ),
    trusted: true,
  };
}

async function lookupHtmlPage(url: string, code = ""): Promise<CatalogHit[]> {
  const html = await fetchHtml(url);
  if (!html || lookupMissHtml(html)) return [];
  const names = namesFromHtml(html);
  if (!names.length) return [];
  const size = sizeFromHtml(html);
  const desc = cleanText(
    html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i)?.[1] ||
      ""
  );
  const trusted = Boolean(jsonLdProductName(html));
  return names.map((name) => {
    const fullName = withSizeInName(name, size || extractSize(name));
    return {
      name: fullName,
      description: clearEnglishDescription(
        fullName,
        describeFromParts([
          size ? `Size: ${size}` : "",
          isJunkName(desc) ? "" : desc,
        ])
      ),
      trusted,
    };
  });
}

async function lookupDuckDuckGo(query: string): Promise<CatalogHit | null> {
  const json = await fetchJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(`${query} Produkt EAN Deutschland`)}&format=json&no_html=1&skip_disambig=1`
  );
  if (json) {
    const heading = cleanText(json.Heading);
    const abstract = cleanText(json.AbstractText || json.Abstract);
    if (!isJunkName(heading)) {
      return { name: heading, description: abstract.slice(0, 220) || heading };
    }
    const related = (json.RelatedTopics as Array<Record<string, unknown>>) || [];
    for (const topic of related) {
      const text = cleanText(topic.Text);
      if (isJunkName(text)) continue;
      const name = text.split(" - ")[0].split(":")[0].slice(0, 80);
      if (!isJunkName(name)) return { name, description: text.slice(0, 220) };
    }
  }

  const html = await fetchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${query} Produkt EAN Deutschland`)}`
  );
  const titles = [...html.matchAll(/class="result__a"[^>]*>([^<]{4,140})<\/a>/gi)];
  for (const title of titles.slice(0, 10)) {
    const name = shortItemName(cleanText(title[1]));
    if (isJunkName(name)) continue;
    return { name, description: clearEnglishDescription(name) };
  }
  return null;
}

async function lookupGermanSearch(code: string): Promise<CatalogHit[]> {
  const html = await fetchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${code} product OR Produkt EAN barcode`)}`
  );
  const titles = [...html.matchAll(/class="result__a"[^>]*>([^<]{4,140})<\/a>/gi)];
  const hits: CatalogHit[] = [];
  for (const title of titles.slice(0, 12)) {
    const name = shortItemName(cleanText(title[1]));
    if (isJunkName(name)) continue;
    if (hits.some((hit) => hit.name.toLowerCase() === name.toLowerCase())) continue;
    hits.push({ name, description: clearEnglishDescription(name), trusted: false });
  }
  return hits;
}

async function lookupWikidata(code: string): Promise<CatalogHit | null> {
  const json = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(code)}&format=json&origin=*`
  );
  const hits = (json?.query as { search?: Array<Record<string, unknown>> })?.search || [];
  const row = hits[0];
  if (!row) return null;
  const name = cleanText(row.title);
  const description = cleanText(row.snippet);
  if (isJunkName(name)) return null;
  return { name, description: description || name };
}

async function lookupWikipedia(query: string): Promise<CatalogHit | null> {
  const json = await fetchJson(
    `https://de.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json&origin=*`
  );
  if (!Array.isArray(json)) return null;
  const names = json[1] as string[] | undefined;
  const descs = json[2] as string[] | undefined;
  const name = cleanText(names?.[0] || "");
  if (isJunkName(name)) return null;
  return { name, description: cleanText(descs?.[0] || name) };
}

async function identifyWithAi(query: string, kind: "barcode" | "name") {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(14000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 160,
        messages: [
          {
            role: "system",
            content:
              'You identify German retail products for VANO German Store. Reply JSON only: {"name":"","description":""}. Name must be the real product (brand + variant + size), easy to read. Description in simple English, 3-4 short sentences: what it is, brand, pack size, and how it is used. No prices. If unsure, empty strings.',
          },
          {
            role: "user",
            content:
              kind === "barcode"
                ? `What product has EAN/GTIN ${query}? Give a clear product name and an English description.`
                : `Clear product name and English description for: ${query}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { name?: string; description?: string };
    const name = cleanText(parsed.name || "");
    const description = cleanText(parsed.description || "");
    if (isJunkName(name)) return null;
    return { name, description: description || name };
  } catch {
    return null;
  }
}

async function collectHits(jobs: Array<Promise<CatalogHit | null | undefined | CatalogHit[]>>) {
  const results = await Promise.allSettled(jobs);
  const hits: CatalogHit[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const list = Array.isArray(result.value) ? result.value : [result.value];
    for (const hit of list) {
      const shortName = shortItemName(hit.name);
      if (!shortName || isJunkName(shortName)) continue;
      const size = extractSize(shortName, hit.description);
      const normalized = {
        name: withSizeInName(shortName, size),
        description: clearEnglishDescription(
          withSizeInName(shortName, size),
          size ? `${hit.description}. Size: ${size}` : hit.description
        ),
        trusted: Boolean(hit.trusted),
      };
      const key = normalized.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(normalized);
    }
  }
  hits.sort((a, b) => germanScore(b) - germanScore(a));
  return hits;
}

async function lookupBarcode(barcode: string) {
  const codes = barcodeVariants(barcode);
  const main = codes[0];
  if (!main) return [];
  const extra = codes.slice(1, 3);
  const q = encodeURIComponent(main);
  return collectHits([
    ...codes.map((code) => lookupOpenFactsCode(code)),
    lookupIcecat(main, "de"),
    lookupIcecat(main, "en"),
    lookupDatakick(main),
    lookupGoUpc(main),
    ...extra.map((code) => lookupGoUpc(code)),
    ...codes.slice(0, 3).map((code) => lookupUpcItemDb(code)),
    lookupGermanSearch(main),
    lookupHtmlPage(`https://go-upc.com/search?q=${q}`, main),
    lookupHtmlPage(`https://barcode.monster/${q}`, main),
    lookupHtmlPage(`https://www.upcitemdb.com/upc/${q}`, main),
    lookupHtmlPage(`https://www.buycott.com/upc/${q}`, main),
    lookupHtmlPage(`https://www.barcodelookup.com/${q}`, main),
    lookupHtmlPage(`https://world.openfoodfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://de.openfoodfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://world.openbeautyfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://de.openbeautyfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://world.openproductsfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://de.openproductsfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://world.openpetfoodfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://de.openpetfoodfacts.org/product/${q}`, main),
    lookupHtmlPage(`https://www.codecheck.info/product.search?q=${q}`, main),
    lookupHtmlPage(`https://www.barcoo.com/${q}`, main),
    lookupHtmlPage(`https://www.barcoo.com/de/${q}`, main),
    lookupHtmlPage(`https://opengtindb.org/index.php?cmd=ean1&ean=${q}`, main),
    lookupHtmlPage(`https://geizhals.de/?fs=${q}`, main),
    lookupHtmlPage(`https://www.idealo.de/preisvergleich/MainSearchProductInfo.html?q=${q}`, main),
    identifyWithAi(main, "barcode"),
  ]);
}

async function searchByName(name: string) {
  const q = encodeURIComponent(name);
  const jobs = OFF_HOSTS.map((host) =>
    fetchJson(
      `${host}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=8`
    ).then((json) =>
      ((json?.products as Record<string, unknown>[]) || []).flatMap((product) =>
        hitFromOffProduct(product)
      )
    )
  );
  return collectHits([
    ...jobs,
    lookupDuckDuckGo(name),
    lookupWikipedia(name),
    lookupGoUpc(name),
    identifyWithAi(name, "name"),
  ]);
}

async function describeWithAi(name: string, extra = "") {
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
          {
            role: "system",
            content:
              "Write 3 or 4 short simple English sentences for a shop item card. Say what the item is, the brand, the pack size, and how to use or store it. Easy words. No prices, no hashtags, no website names.",
          },
          {
            role: "user",
            content: extra
              ? `Product name: ${name}\nKnown details: ${extra}`
              : `Product name: ${name}`,
          },
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

  if (barcode) matches = await lookupBarcode(barcode);
  if (matches.length === 0 && typedName) matches = await searchByName(typedName);

  const cleanedMatches = matches.slice(0, 24).map((match) => ({
    ...match,
    name: shortItemName(match.name) || match.name,
    description: uniqueSentences(
      clearEnglishDescription(match.name, match.description).split(/(?<=[.!?])\s+/)
    ),
  }));
  const trusted = cleanedMatches.filter((match) => match.trusted);
  const hit = trusted[0] || cleanedMatches[0] || null;
  const name = hit?.name || "";
  let description = hit?.description || "";
  if (name) {
    description = uniqueSentences(
      clearEnglishDescription(name, description).split(/(?<=[.!?])\s+/)
    );
  }

  return {
    name,
    description:
      typedName && !hit ? clearEnglishDescription(typedName) : description,
    matches: cleanedMatches,
    found: cleanedMatches.length > 0,
  };
}
