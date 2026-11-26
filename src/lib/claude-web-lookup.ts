import Anthropic from "@anthropic-ai/sdk";

/**
 * Last-resort barcode lookup: Claude searches the live web for the exact
 * EAN/GTIN and reports the product name, an English description and the
 * usual German shop price in EUR. Used when the free catalogs and shop
 * scrapers miss, or find a name but no price.
 */

export type WebProduct = {
  name: string;
  description: string;
  priceEur?: number;
  sourceUrl?: string;
  confident: boolean;
};

const SYSTEM = `You look up retail products by barcode for VANO German Store, a shop in Lebanon that imports goods from Germany.
Use web search to find the product that carries the exact EAN/GTIN you are given. Good sources: dm.de, rossmann.de, mueller.de, kaufland.de, amazon.de, idealo.de, ebay.de, the brand's own site, Open Food Facts, barcode databases. Search the plain number first, then add words like "EAN" if needed.
Only accept a product when a page shows this exact barcode, or two independent sources tie it to the same product. Never guess from the barcode prefix alone.

When you are done, reply with ONE JSON object and nothing else:
{"name": "", "description": "", "priceEur": null, "sourceUrl": "", "confident": false}

- name: English shop name, brand + product type + size, e.g. "Balea Shower Gel Aloe Vera 300 ml". Translate German product types to English (Duschgel -> Shower Gel, Zahnpasta -> Toothpaste). Keep the brand as written.
- description: 2-4 short, simple English sentences: what it is, brand, pack size, scent or flavour, how to use it. If you found ingredients, end with "Ingredients: ...". No prices, no website names.
- priceEur: the normal German retail price in euros for ONE unit, as a number (e.g. 1.95). Prefer dm, Rossmann, Müller, Kaufland or the brand shop; otherwise the lowest normal (non-bulk, non-used) offer you saw. null if you found no price.
- sourceUrl: the page where you confirmed the barcode.
- confident: true only if a page shows this exact barcode for this product.
If you cannot identify the product, return empty strings, null price and confident false.`;

const cache = new Map<string, { at: number; value: Promise<WebProduct | null> }>();
const CACHE_MS = 10 * 60 * 1000;

function apiKey() {
  return (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
}

export function webLookupAvailable() {
  return Boolean(apiKey());
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(raw: unknown) {
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 20000) return undefined;
  return Math.round(n * 100) / 100;
}

/** Pull the last {...} JSON object out of the model's final text. */
function parseAnswer(text: string): WebProduct | null {
  const candidates = text.match(/\{[^{}]*"name"[^{}]*\}/g);
  const raw = candidates?.[candidates.length - 1];
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const name = cleanText(data.name);
    if (name.length < 3) return null;
    return {
      name,
      description: cleanText(data.description),
      priceEur: parsePrice(data.priceEur),
      sourceUrl: cleanText(data.sourceUrl) || undefined,
      confident: data.confident === true,
    };
  } catch {
    return null;
  }
}

async function runSearch(barcode: string, hint: string): Promise<WebProduct | null> {
  const key = apiKey();
  if (!key) return null;
  const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 1 });
  const model = process.env.CLAUDE_SEARCH_MODEL || "claude-opus-5-5";

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: hint
        ? `Barcode (EAN/GTIN): ${barcode}\nA catalog suggested this name, which may be wrong or incomplete: ${hint}`
        : `Barcode (EAN/GTIN): ${barcode}`,
    },
  ];

  try {
    // Web search runs server-side; a long search can pause the turn, so resume a few times.
    for (let round = 0; round < 4; round++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: 6,
            user_location: { type: "approximate", country: "DE" },
          },
        ],
        messages,
      });

      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal") return null;

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return parseAnswer(text);
    }
    return null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("[barcode web lookup] Anthropic API key was rejected.");
    } else if (error instanceof Anthropic.RateLimitError) {
      console.error("[barcode web lookup] Rate limited by the Claude API.");
    } else if (error instanceof Anthropic.APIError) {
      console.error(`[barcode web lookup] Claude API error ${error.status}: ${error.message}`);
    } else {
      console.error("[barcode web lookup] failed:", error);
    }
    return null;
  }
}

/**
 * Search the web for this barcode. Results (including misses) are reused for
 * 10 minutes so one scan never pays for the same search twice.
 */
export function lookupBarcodeOnWeb(barcode: string, hint = ""): Promise<WebProduct | null> {
  const digits = barcode.replace(/\D/g, "");
  if (digits.length < 8 || !apiKey()) return Promise.resolve(null);
  const now = Date.now();
  for (const [code, entry] of cache) {
    if (now - entry.at > CACHE_MS) cache.delete(code);
  }
  const hit = cache.get(digits);
  if (hit) return hit.value;
  const value = runSearch(digits, cleanText(hint));
  cache.set(digits, { at: now, value });
  return value;
}
