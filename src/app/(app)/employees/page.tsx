import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { EmployeesManager } from "./EmployeesManager";
import { getCachedEmployees } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { readSnapshot } from "@/lib/local-db";

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const local = readSnapshot<
    {
      id: string;
      name: string;
      email: string;
      active: boolean;
      createdAt: string;
    }[]
  >("employees");
  let employees = local || [];
  if (!local) {
    try {
      employees = await getCachedEmployees();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Create, edit, and disable cashier accounts. No custom permissions."
      />
      <EmployeesManager employees={employees} />
    </div>
  );
}
