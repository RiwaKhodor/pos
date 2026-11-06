import { code128Bars } from "@/lib/code128";

export function Barcode({ value }: { value: string }) {
  const bars = code128Bars(value);
  const width = bars.length || 1;
  return (
    <svg
      className="barcode"
      viewBox={`0 0 ${width} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={value}
    >
      {bars.split("").map((bit, i) =>
        bit === "1" ? <rect key={i} x={i} y="0" width="1" height="40" /> : null
      )}
    </svg>
  );
}
