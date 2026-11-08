import { BrandSplash } from "@/components/BrandSplash";
import { isOwnerWeb } from "@/lib/host";

export default function RootLoading() {
  if (!isOwnerWeb()) return null;
  return <BrandSplash />;
}
