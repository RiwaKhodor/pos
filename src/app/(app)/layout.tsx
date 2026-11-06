import { AppShell } from "@/components/AppShell";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getStoreNameFromCookie } from "@/lib/store-cookie";
import { isOwnerWeb } from "@/lib/host";
import { LiveStore } from "@/components/LiveStore";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Cookie + JWT only — no DB on every navigation
  const [user, storeName] = await Promise.all([
    getSessionUser(),
    getStoreNameFromCookie(),
  ]);
  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell user={user} storeName={storeName} ownerWeb={isOwnerWeb()}>
      {isOwnerWeb() ? <LiveStore /> : null}
      {children}
    </AppShell>
  );
}
