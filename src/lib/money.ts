import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

type DecimalLike =
  | Prisma.Decimal
  | number
  | string
  | null
  | undefined
  | { toNumber: () => number };

/** Convert Prisma Decimal (or similar) to a plain JS number for math/UI. */
export function toNum(value: DecimalLike): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isDecimalLike(value: unknown): value is { toNumber: () => number } {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { toNumber?: unknown }).toNumber === "function" &&
    (value instanceof Prisma.Decimal ||
      value.constructor?.name === "Decimal" ||
      "s" in (value as object))
  );
}

/** Deep-convert Prisma Decimals to numbers so JSON/clients stay number-based. */
export function decimalsToNumbers<T>(value: T): T {
  if (value == null) return value;
  if (isDecimalLike(value)) {
    return toNum(value) as T;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => decimalsToNumbers(item)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = decimalsToNumbers(v);
    }
    return out as T;
  }
  return value;
}

export function jsonMoney<T>(
  data: T,
  init?: ResponseInit
): NextResponse {
  return NextResponse.json(decimalsToNumbers(data), init);
}
