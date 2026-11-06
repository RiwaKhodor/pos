"use client";

export function PageLoading() {
  return (
    <div className="desk-panel" style={{ minHeight: 200 }}>
      <div className="mb-3 text-sm font-bold text-slate-500">Loading…</div>
      <div className="h-2 w-40 animate-pulse rounded bg-slate-300" />
      <div className="mt-4 space-y-2">
        <div className="h-8 animate-pulse rounded bg-slate-200" />
        <div className="h-8 animate-pulse rounded bg-slate-200" />
        <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}
