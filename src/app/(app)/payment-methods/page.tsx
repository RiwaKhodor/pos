import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { PaymentMethodsManager } from "./PaymentMethodsManager";
import { getCachedPaymentMethods } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";

export default async function PaymentMethodsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const local = readSnapshot<
    {
      id: string;
      name: string;
      active: boolean;
      createdAt: string;
      updatedAt: string;
    }[]
  >("payment-methods");
  let methods = local || [];
  if (!local) {
    try {
      methods = await getCachedPaymentMethods();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payment methods"
        subtitle="Cash, card, and other tenders used at checkout"
      />
      <PaymentMethodsManager methods={methods} />
    </div>
  );
}
