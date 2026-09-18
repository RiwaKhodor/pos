import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/AppShell";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const settings = await prisma.storeSettings.findUnique({
    where: { id: "default" },
    select: { storeName: true },
  });

  return (
    <AppShell user={user} storeName={settings?.storeName || "Store"}>
      {children}
    </AppShell>
  );
}
