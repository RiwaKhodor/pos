/**
 * Local dm price book.
 *
 * dm's product search answers "429 Too many requests" when one address asks too
 * often, so scanning many dm items in a row used to lose prices. Every dm search
 * answer is saved here (barcode -> product + price), and a slow background job
 * downloads dm's own brands once a day. Scans read this book first and only ask
 * dm live when the barcode is not in it.
 */
import { localDb } from "@/lib/local-db";

const DM_SEARCH = "https://product-search.services.dmtech.com/de/search";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** dm's own brands — what a dm shop's stock is mostly made of. */
const DM_BRANDS = [
  "Balea",
  "Balea MEN",
  "alverde",
  "ebelin",
  "Denkmit",
  "Profissimo",
  "Mivolis",
  "Das gesunde Plus",
  "dmBio",
  "babylove",
  "SUNDANCE",
  "Dontodent",
  "s-he colour&style",
  "trend IT UP",
  "Paradies",
  "Jessa",
  "Visiomax",
  "SEINZ",
  "Alana",
  "Dein Bestes",
  "Saltin",
  "free deo",
  "Bevola",
];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Gap between two background requests, so the sync never triggers a block. */
const SYNC_GAP_MS = 4000;

let tableReady = false;

function db() {
  const local = localDb();
  if (!tableReady) {
    local.exec(`
      CREATE TABLE IF NOT EXISTS dm_products (
        gtin TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        title TEXT NOT NULL,
        price REAL NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS dm_products_brand ON dm_products(brand);
    `);
    tableReady = true;
  }
  return local;
}

function text(value: unknown) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function productGtin(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  return text(product.gtin || tile.gtin).replace(/\D/g, "");
}

function productBrand(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  return text(product.brandName || (tile.brand as Record<string, unknown> | undefined)?.name);
}

function productTitle(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  const titleNode = tile.title as Record<string, unknown> | undefined;
  return text(titleNode?.tileHeadline || product.title);
}

function productPrice(product: Record<string, unknown>) {
  const tile = (product.tileData as Record<string, unknown> | undefined) || {};
  const tracking = (tile.trackingData as Record<string, unknown> | undefined) || {};
  const priceNode = (tile.price as Record<string, unknown> | undefined) || {};
  const current =
    ((priceNode.price as Record<string, unknown> | undefined)?.current as
      | Record<string, unknown>
      | undefined) || {};
  for (const raw of [tracking.price, current.value]) {
    const n = Number(String(raw ?? "").replace(/[^\d.,]/g, "").replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n < 5000) return n;
  }
  return 0;
}

/** Save every product of a dm search answer. */
export function rememberDmProducts(products: Record<string, unknown>[]) {
  if (!products.length) return;
  try {
    const local = db();
    const upsert = local.prepare(
      `INSERT INTO dm_products (gtin, brand, title, price, json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(gtin) DO UPDATE SET brand = excluded.brand, title = excluded.title,
         price = excluded.price, json = excluded.json, updated_at = excluded.updated_at`
    );
    const now = new Date().toISOString();
    for (const product of products) {
      const gtin = productGtin(product);
      const price = productPrice(product);
      if (gtin.length < 8 || !(price > 0)) continue;
      upsert.run(gtin, productBrand(product), productTitle(product), price, JSON.stringify(product), now);
    }
  } catch (error) {
    console.error("dm price book save failed", error);
  }
}

/** The saved dm product for this barcode (also matches with/without leading zeros). */
export function dmBookProduct(code: string): Record<string, unknown> | null {
  const digits = code.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const bare = digits.replace(/^0+/, "");
  try {
    const row = db()
      .prepare(
        "SELECT json FROM dm_products WHERE gtin = ? OR ltrim(gtin, '0') = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(digits, bare) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Saved dm products of one brand whose title has this pack size (for re-listed barcodes). */
export function dmBookByBrandAndSize(brandWord: string, size: string, limit = 60) {
  const brand = brandWord.trim().toLowerCase();
  if (!brand) return [];
  try {
    const rows = db()
      .prepare(
        `SELECT json, title FROM dm_products
         WHERE lower(brand) LIKE ? ORDER BY updated_at DESC LIMIT 2000`
      )
      .all(`${brand}%`) as { json: string; title: string }[];
    const wanted = size.replace(/\s/g, "").toLowerCase();
    return rows
      .filter((row) => !wanted || row.title.replace(/\s/g, "").toLowerCase().includes(wanted))
      .slice(0, limit)
      .map((row) => JSON.parse(row.json) as Record<string, unknown>);
  } catch {
    return [];
  }
}

export function dmBookCount() {
  try {
    const row = db().prepare("SELECT COUNT(*) AS n FROM dm_products").get() as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

function getMetaValue(key: string) {
  try {
    const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value || "";
  } catch {
    return "";
  }
}

function setMetaValue(key: string, value: string) {
  try {
    db()
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(key, value);
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SyncState = { running: boolean; blockedUntil: number };
const syncState = (globalThis as unknown as { vanoDmSync?: SyncState }).vanoDmSync ||
  ((globalThis as unknown as { vanoDmSync?: SyncState }).vanoDmSync = {
    running: false,
    blockedUntil: 0,
  });

/** Tell the background sync to pause (a live scan just got a 429). */
export function pauseDmSync(ms: number) {
  syncState.blockedUntil = Math.max(syncState.blockedUntil, Date.now() + ms);
}

async function fetchPage(query: string, page: number) {
  const url = `${DM_SEARCH}?query=${encodeURIComponent(query)}&searchType=product&pageSize=60&currentPage=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json", "Accept-Language": "de-DE,de;q=0.9" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (res.status === 429) return "blocked" as const;
  if (!res.ok) return null;
  return (await res.json()) as { products?: Record<string, unknown>[]; totalPages?: number };
}

/**
 * Download dm's own brands into the price book, slowly. Runs at most once a day;
 * after a 429 it stops and tries again 30 minutes later.
 */
export async function syncDmPriceBook(force = false) {
  if (syncState.running) return;
  const last = Number(getMetaValue("dm_book_synced_at") || 0);
  const retryAt = Number(getMetaValue("dm_book_retry_at") || 0);
  if (!force && (Date.now() - last < DAY_MS || Date.now() < retryAt)) return;
  syncState.running = true;
  let saved = 0;
  try {
    for (const brand of DM_BRANDS) {
      for (let page = 0; page < 40; page += 1) {
        while (Date.now() < syncState.blockedUntil) await sleep(5000);
        let data: Awaited<ReturnType<typeof fetchPage>> = null;
        try {
          data = await fetchPage(brand, page);
        } catch {
          data = null;
        }
        if (data === "blocked") {
          setMetaValue("dm_book_retry_at", String(Date.now() + 30 * 60 * 1000));
          return;
        }
        if (!data) break;
        const products = data.products || [];
        // Keep only that brand's items (dm search also returns related products).
        const brandWord = brand.toLowerCase().split(/\s+/)[0];
        const mine = products.filter((p) => productBrand(p).toLowerCase().includes(brandWord));
        rememberDmProducts(mine.length ? mine : products);
        saved += products.length;
        await sleep(SYNC_GAP_MS);
        if (!products.length || page + 1 >= Number(data.totalPages || 0)) break;
      }
    }
    setMetaValue("dm_book_synced_at", String(Date.now()));
    setMetaValue("dm_book_retry_at", "0");
    console.log(`dm price book updated: ${saved} products read, ${dmBookCount()} saved`);
  } catch (error) {
    console.error("dm price book sync failed", error);
  } finally {
    syncState.running = false;
  }
}
