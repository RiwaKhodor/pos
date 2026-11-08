import { isOwnerWeb } from "@/lib/host";

export default function AppLoading() {
  if (isOwnerWeb()) return null;
  return (
    <div className="desk-panel">
      <div className="text-sm font-bold">Opening…</div>
    </div>
  );
}
