type BrandSplashProps = {
  label?: string;
};

export function BrandSplash({
  label = "VANO German Store",
}: BrandSplashProps) {
  return (
    <div className="brand-splash">
      <p>{label}</p>
    </div>
  );
}
