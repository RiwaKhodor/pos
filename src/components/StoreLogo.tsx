type StoreLogoProps = {
  size?: number;
  className?: string;
};

export function StoreLogo({ size = 32, className = "" }: StoreLogoProps) {
  return (
    <span
      className={`store-logo ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png?v=5" alt="VANO German Store" width={size} height={size} />
    </span>
  );
}
