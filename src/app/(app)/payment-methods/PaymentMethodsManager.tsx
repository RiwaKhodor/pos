"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";

type Method = {
  id: string;
  name: string;
  active: boolean;
};

export function PaymentMethodsManager({ methods }: { methods: Method[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function createMethod(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/payment-methods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to create method");
      return;
    }
    setName("");
    router.refresh();
  }

  async function toggleActive(method: Method) {
    await fetch(`/api/payment-methods/${method.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !method.active }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <form onSubmit={createMethod} className="flex flex-col gap-2 sm:flex-row">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Payment method name"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
            Add method
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </Panel>
      <Panel>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {methods.map((method) => (
              <tr key={method.id}>
                <td>{method.name}</td>
                <td>{method.active ? "Active" : "Disabled"}</td>
                <td>
                  <button
                    onClick={() => toggleActive(method)}
                    className="text-xs text-slate-700 underline"
                  >
                    {method.active ? "Disable" : "Enable"}
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
