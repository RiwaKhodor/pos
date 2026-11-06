import { NextResponse } from "next/server";
import { authErrorResponse, hashPassword, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import {
  findKnownUserById,
  rememberUser,
  upsertLocalEmployee,
} from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { localDb, readSnapshot } from "@/lib/local-db";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    let employee: {
      id: string;
      name: string;
      email: string;
      passwordHash: string;
      role: string;
      active: boolean;
      createdAt: Date | string;
    } | null = null;
    try {
      employee = await prisma.user.findFirst({
        where: { id, role: Role.EMPLOYEE },
      });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
    }
    if (!employee) {
      const known = findKnownUserById(id);
      const listed = (
        readSnapshot<
          { id: string; name: string; email: string; active: boolean; createdAt: string }[]
        >("employees") || []
      ).find((row) => row.id === id);
      if (!known && !listed) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }
      employee = {
        id,
        name: known?.name || listed?.name || "",
        email: known?.email || listed?.email || "",
        passwordHash: known?.passwordHash || "",
        role: known?.role || Role.EMPLOYEE,
        active: known ? Boolean(known.active) : Boolean(listed?.active),
        createdAt: listed?.createdAt || new Date().toISOString(),
      };
    }

    const data: {
      name?: string;
      email?: string;
      active?: boolean;
      passwordHash?: string;
    } = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) data.email = String(body.email).trim().toLowerCase();
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.password) data.passwordHash = await hashPassword(String(body.password));

    const updated = {
      id: employee.id,
      name: data.name ?? employee.name,
      email: data.email ?? employee.email,
      role: employee.role,
      active: data.active ?? employee.active,
      createdAt: employee.createdAt,
    };
    const passwordHash = data.passwordHash || employee.passwordHash;
    if (passwordHash) {
      rememberUser({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        passwordHash,
        role: updated.role,
        active: updated.active,
      });
    } else {
      localDb()
        .prepare(
          "UPDATE known_users SET name = ?, email = ?, active = ? WHERE id = ?"
        )
        .run(updated.name, updated.email, updated.active ? 1 : 0, updated.id);
    }
    upsertLocalEmployee(updated);
    const payload = {
      ...updated,
      createdAt:
        updated.createdAt instanceof Date
          ? updated.createdAt.toISOString()
          : updated.createdAt,
      passwordHash: passwordHash || undefined,
    };
    try {
      await prisma.user.update({ where: { id }, data });
      const { dropOp } = await import("@/lib/offline-ops");
      dropOp(`employee:${id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`employee:${id}`, "employee.upsert", payload);
    }
    void syncPendingSales();
    bustCache("employees");
    const parts: string[] = [];
    if (data.name && data.name !== employee.name) {
      parts.push(`name ${employee.name} → ${updated.name}`);
    }
    if (data.email && data.email !== employee.email) {
      parts.push(`email ${employee.email} → ${updated.email}`);
    }
    if (data.active !== undefined && data.active !== employee.active) {
      parts.push(updated.active ? "enabled" : "disabled");
    }
    if (data.passwordHash) parts.push("password changed");
    notifyOwners({
      title: "Cashier updated",
      body:
        parts.length > 0
          ? `${updated.name}: ${parts.join("; ")}`
          : `${updated.name} was updated`,
      url: "/owner",
      tag: `employee:${id}:${Date.now()}`,
    });
    return NextResponse.json({ employee: updated });
  } catch (error) {
    return authErrorResponse(error);
  }
}
