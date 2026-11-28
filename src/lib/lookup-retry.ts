/**
 * Barcodes that found no name are searched again quietly in the background.
 *
 * Free barcode sites refuse requests at busy moments and answer a few minutes
 * later. A barcode that found nothing is retried after 3, 10, 30 minutes, then
 * hourly (about a day in total). When a name turns up it is saved for every PC,
 * and an open New Item form fills it in by itself.
 */
import { localDb } from "@/lib/local-db";

const DELAYS_MIN = [3, 10, 30, 60, 60, 120, 120, 240, 480, 720];

let ready = false;
function db() {
  const local = localDb();
  if (!ready) {
    local.exec(`CREATE TABLE IF NOT EXISTS lookup_retry (
      code TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL
    )`);
    ready = true;
  }
  return local;
}

export function queueLookupRetry(code: string) {
  const digits = code.replace(/\D/g, "");
  if (digits.length < 8) return;
  try {
    db()
      .prepare(
        `INSERT INTO lookup_retry (code, attempts, next_at) VALUES (?, 0, ?)
         ON CONFLICT(code) DO NOTHING`
      )
      .run(digits, Date.now() + DELAYS_MIN[0] * 60 * 1000);
  } catch {
    /* ignore */
  }
}

export function dropLookupRetry(code: string) {
  try {
    db().prepare("DELETE FROM lookup_retry WHERE code = ?").run(code.replace(/\D/g, ""));
  } catch {
    /* ignore */
  }
}

let running = false;

/** Retry up to two due barcodes. Called every couple of minutes. */
export async function retryPendingLookups() {
  if (running) return;
  running = true;
  try {
    const due = db()
      .prepare("SELECT code, attempts FROM lookup_retry WHERE next_at <= ? ORDER BY next_at LIMIT 2")
      .all(Date.now()) as { code: string; attempts: number }[];
    if (!due.length) return;
    const { lookupProduct, recallFoundBarcode } = await import("@/lib/product-lookup");
    for (const row of due) {
      if ((await recallFoundBarcode(row.code)).length) {
        dropLookupRetry(row.code);
        continue;
      }
      let found = false;
      try {
        const result = await lookupProduct({ barcode: row.code });
        found = Boolean(result.found && result.name);
      } catch {
        found = false;
      }
      if (found) {
        dropLookupRetry(row.code);
        continue;
      }
      const attempts = row.attempts + 1;
      if (attempts >= DELAYS_MIN.length) {
        dropLookupRetry(row.code);
        continue;
      }
      db()
        .prepare("UPDATE lookup_retry SET attempts = ?, next_at = ? WHERE code = ?")
        .run(attempts, Date.now() + DELAYS_MIN[attempts] * 60 * 1000, row.code);
    }
  } catch (error) {
    console.error("Background barcode retry failed", error);
  } finally {
    running = false;
  }
}
