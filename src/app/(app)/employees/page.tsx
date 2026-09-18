import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { EmployeesManager } from "./EmployeesManager";

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== Role.OWNER) redirect("/pos");

  const employees = await prisma.user.findMany({
    where: { role: Role.EMPLOYEE },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      createdAt: true,
    },
  });

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Create, edit, and disable cashier accounts. No custom permissions."
      />
      <EmployeesManager
        employees={employees.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
