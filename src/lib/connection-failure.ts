export function isConnectionFailure(status: number, error?: string) {
  if (status >= 500 || status === 0) return true;
  return /database|internet|Internal server|too long|offline|connection/i.test(
    error || ""
  );
}
