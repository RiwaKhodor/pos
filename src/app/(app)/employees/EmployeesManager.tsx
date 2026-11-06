"use client";

import { FormEvent, Fragment, useState } from "react";
import { Panel } from "@/components/ui";
import { isConnectionFailure } from "@/lib/connection-failure";

type Employee = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
};

export function EmployeesManager({ employees }: { employees: Employee[] }) {
  const [rows, setRows] = useState(employees);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [nextPassword, setNextPassword] = useState("");

  async function createEmployee(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy("create");
    const pending = { ...form };
    const draft: Employee = {
      id: `new-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim(),
      active: true,
      createdAt: new Date().toISOString(),
    };
    setRows((current) => [draft, ...current]);
    setForm({ name: "", email: "", password: "" });
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
    });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setRows((current) => current.filter((row) => row.id !== draft.id));
      setForm(pending);
      setError(data.error || "Failed to create employee");
      return;
    }
    const employee = data.employee as Employee;
    setRows((current) =>
      current.map((row) => (row.id === draft.id ? employee : row))
    );
  }

  async function toggleActive(employee: Employee) {
    const next = !employee.active;
    setRows((current) =>
      current.map((row) =>
        row.id === employee.id ? { ...row, active: next } : row
      )
    );
    const res = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (isConnectionFailure(res.status, data.error)) return;
      setRows((current) =>
        current.map((row) =>
          row.id === employee.id ? { ...row, active: employee.active } : row
        )
      );
      setError(data.error || "Could not update this employee");
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    const password = nextPassword.trim();
    if (!resetFor || !password) return;
    setBusy(resetFor);
    setError("");
    setNotice("");
    const res = await fetch(`/api/employees/${resetFor}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!isConnectionFailure(res.status, data.error)) {
        setError(data.error || "Failed to update password");
      }
      return;
    }
    setNextPassword("");
    setResetFor(null);
    setNotice("Password saved. The cashier uses it the next time they sign in.");
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
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white sm:col-span-3"
            disabled={busy === "create"}
          >
            {busy === "create" ? "Saving..." : "Create employee"}
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-2 text-sm text-green-700">{notice}</p> : null}
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
            {rows.map((employee) => (
              <Fragment key={employee.id}>
              <tr>
                <td>{employee.name}</td>
                <td>{employee.email}</td>
                <td>{employee.active ? "Active" : "Disabled"}</td>
                <td className="space-x-2">
                  <button
                    type="button"
                    onClick={() => toggleActive(employee)}
                    className="text-xs text-slate-700 underline"
                  >
                    {employee.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetFor(employee.id);
                      setNextPassword("");
                      setNotice("");
                      setError("");
                    }}
                    className="text-xs text-slate-700 underline"
                  >
                    Reset password
                  </button>
                </td>
              </tr>
              {resetFor === employee.id ? (
                <tr key={`${employee.id}-reset`}>
                  <td colSpan={4}>
                    <form onSubmit={resetPassword} className="flex flex-wrap items-center gap-2 py-1">
                      <input
                        autoFocus
                        required
                        type="password"
                        placeholder="New password"
                        value={nextPassword}
                        onChange={(e) => setNextPassword(e.target.value)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={busy === employee.id}
                        className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white"
                      >
                        {busy === employee.id ? "Saving..." : "Save password"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetFor(null)}
                        className="text-xs text-slate-700 underline"
                      >
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
