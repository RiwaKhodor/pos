import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { PaymentMethodsManager } from "./PaymentMethodsManager";

export default async function PaymentMethodsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const methods = await prisma.paymentMethod.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Payment methods"
        subtitle="Manage how customers can pay"
      />
      <PaymentMethodsManager methods={methods} />
    </div>
  );
}
