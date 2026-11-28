/**
 * Barcode names shared between all PCs through the online database.
 *
 * Free barcode sites answer one PC and refuse another, depending on the moment.
 * Whatever any PC finds is saved here, so every PC gets that name instantly
 * afterwards and never has to search for it again.
 */
import { prisma } from "@/lib/prisma";
import { localDb } from "@/lib/local-db";

export type SharedHit = {
  name: string;
  description: string;
  trusted?: boolean;
  priceEur?: number;
  source?: string;
};

let tableReady: Promise<boolean> | null = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = prisma
      .$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "BarcodeLookup" (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          matches_json TEXT,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      )
      .then(() => true)
      .catch(() => {
        tableReady = null; // database offline: try again next time
        return false;
      });
  }
  return tableReady;
}

function digitsOf(code: string) {
  return code.replace(/\D/g, "");
}

async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Names another PC (or this one) already found for this barcode. */
export async function recallSharedLookup(code: string): Promise<SharedHit[]> {
  const digits = digitsOf(code);
  if (digits.length < 8) return [];
  return withTimeout(
    (async () => {
      if (!(await ensureTable())) return [];
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT name, description, matches_json FROM "BarcodeLookup" WHERE code = $1 OR code = $2 LIMIT 1`,
        digits,
        digits.replace(/^0+/, "")
      )) as { name: string; description: string | null; matches_json: string | null }[];
      const row = rows[0];
      if (!row?.name) return [];
      try {
        const matches = JSON.parse(row.matches_json || "[]") as SharedHit[];
        if (Array.isArray(matches) && matches.length) return matches.filter((m) => m?.name);
      } catch {
        /* use the single name below */
      }
      return [{ name: row.name, description: row.description || "", trusted: true }];
    })().catch(() => [] as SharedHit[]),
    4000,
    [] as SharedHit[]
  );
}

/** Save what was found so every PC can reuse it. Never throws. */
export async function rememberSharedLookup(code: string, hits: SharedHit[]) {
  const digits = digitsOf(code);
  if (digits.length < 8 || !hits.length || !hits[0].name) return;
  try {
    if (!(await ensureTable())) return;
    const matches = hits.slice(0, 12).map((hit) => ({
      name: hit.name,
      description: hit.description || "",
      trusted: hit.trusted,
      priceEur: hit.priceEur,
      source: hit.source,
    }));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BarcodeLookup" (code, name, description, matches_json, "updatedAt")
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         matches_json = EXCLUDED.matches_json, "updatedAt" = now()`,
      digits,
      hits[0].name,
      hits[0].description || "",
      JSON.stringify(matches)
    );
  } catch {
    /* offline: the local copy still has it, and it is uploaded later */
  }
}

/** Upload names this PC found before sharing existed (or while offline). */
export async function uploadLocalLookups() {
  try {
    const local = localDb();
    local.exec(`CREATE TABLE IF NOT EXISTS barcode_lookups (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, matches_json TEXT, updated_at TEXT
    )`);
    const since =
      (local.prepare("SELECT value FROM meta WHERE key = 'shared_lookups_uploaded_at'").get() as
        | { value: string }
        | undefined)?.value || "";
    const rows = local
      .prepare(
        "SELECT code, name, description, matches_json, updated_at FROM barcode_lookups WHERE updated_at > ? ORDER BY updated_at"
      )
      .all(since) as {
      code: string;
      name: string;
      description: string | null;
      matches_json: string | null;
      updated_at: string;
    }[];
    if (!rows.length || !(await ensureTable())) return;
    let last = since;
    for (const row of rows) {
      let hits: SharedHit[] = [];
      try {
        hits = JSON.parse(row.matches_json || "[]") as SharedHit[];
      } catch {
        hits = [];
      }
      if (!hits.length) hits = [{ name: row.name, description: row.description || "" }];
      await rememberSharedLookup(row.code, hits);
      last = row.updated_at;
    }
    local
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('shared_lookups_uploaded_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(last);
  } catch (error) {
    console.error("Uploading found barcode names failed", error);
  }
}
