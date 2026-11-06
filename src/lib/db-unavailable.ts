const DB_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
]);

export function isDbUnavailable(error: unknown) {
  if (error instanceof Error && !("code" in error) && !("errorCode" in error)) {
    return /offline|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|Can't reach database|getaddrinfo/i.test(
      error.message
    );
  }
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; errorCode?: string; message?: string };
  const code = String(record.code || record.errorCode || "");
  if (DB_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(record.message || "");
  return /Can't reach database|Server has closed the connection|Timed out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|OFFLINE|getaddrinfo/i.test(
    message
  );
}
