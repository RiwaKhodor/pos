"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

type Employee = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
};

export function EmployeesManager({ employees }: { employees: Employee[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");

  async function createEmployee(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create employee");
      return;
    }
    setForm({ name: "", email: "", password: "" });
    router.refresh();
  }

  async function toggleActive(employee: Employee) {
    await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !employee.active }),
    });
    router.refresh();
  }

  async function resetPassword(id: string) {
    const password = prompt("Enter a new password for this employee");
    if (!password) return;
    const res = await fetch(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to update password");
      return;
    }
    alert("Password updated");
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-700">
          Add employee
        </h2>
        <form
          onSubmit={createEmployee}
          className="grid gap-3 sm:grid-cols-3"
        >
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            placeholder="Temporary password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-3">
            Create employee
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </Panel>

      <Panel>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>{employee.name}</td>
                <td>{employee.email}</td>
                <td>{employee.active ? "Active" : "Disabled"}</td>
                <td className="space-x-2">
                  <button
                    onClick={() => toggleActive(employee)}
                    className="text-xs text-slate-700 underline"
                  >
                    {employee.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => resetPassword(employee.id)}
                    className="text-xs text-slate-700 underline"
                  >
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
