import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { ContainerForm } from "../ContainerForm";

export default async function NewContainerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  return <ContainerForm mode="create" products={[]} />;
}
