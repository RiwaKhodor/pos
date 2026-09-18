import { NextResponse } from "next/server";
import { authErrorResponse, hashPassword, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    const employee = await prisma.user.findFirst({
      where: { id, role: Role.EMPLOYEE },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const data: {
      name?: string;
      email?: string;
      active?: boolean;
      passwordHash?: string;
    } = {};

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.email !== undefined) {
      data.email = String(body.email).trim().toLowerCase();
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.password) {
      data.passwordHash = await hashPassword(String(body.password));
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ employee: updated });
  } catch (error) {
    return authErrorResponse(error);
  }
}
