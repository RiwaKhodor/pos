import { NextResponse } from "next/server";
import { authErrorResponse, hashPassword, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { findKnownUser, rememberUser, upsertLocalEmployee } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dropOp, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { readSnapshot } from "@/lib/local-db";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    try {
      const employees = await prisma.user.findMany({
        where: { role: Role.EMPLOYEE },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return NextResponse.json({ employees });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      return NextResponse.json({
        employees: readSnapshot("employees") || [],
      });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
        { status: 400 }
      );
    }

    const localExisting = findKnownUser(email);
    if (localExisting) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 400 }
      );
    }

    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 400 }
        );
      }
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
    }

    const passwordHash = await hashPassword(password);
    const employee = {
      id: crypto.randomUUID(),
      name,
      email,
      role: Role.EMPLOYEE,
      active: true,
      createdAt: new Date().toISOString(),
    };
    const payload = { ...employee, passwordHash, pendingCreate: true };
    rememberUser({ ...employee, passwordHash });
    upsertLocalEmployee(employee);

    try {
      await prisma.user.create({
        data: {
          id: employee.id,
          name,
          email,
          passwordHash,
          role: Role.EMPLOYEE,
          active: true,
        },
      });
      dropOp(`employee:${employee.id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`employee:${employee.id}`, "employee.upsert", payload);
    }
    void syncPendingSales();
    bustCache("employees");
    notifyOwners({
      title: "Cashier added",
      body: `${name} · ${email}`,
      url: "/owner",
      tag: `employee:${employee.id}:${Date.now()}`,
    });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
