import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { NotificationSettings } from "./NotificationSettings";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");
  return <NotificationSettings />;
}
