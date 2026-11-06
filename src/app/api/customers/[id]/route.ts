import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    const before = await prisma.customer.findUnique({ where: { id } });
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        email:
          body.email !== undefined
            ? body.email
              ? String(body.email).trim()
              : null
            : undefined,
        phone:
          body.phone !== undefined
            ? body.phone
              ? String(body.phone).trim()
              : null
            : undefined,
      },
    });

    const parts: string[] = [];
    if (before && before.name !== customer.name) {
      parts.push(`name ${before.name} → ${customer.name}`);
    }
    if (before && before.phone !== customer.phone) {
      parts.push(`phone ${before.phone || "none"} → ${customer.phone || "none"}`);
    }
    if (before && before.email !== customer.email) {
      parts.push(`email ${before.email || "none"} → ${customer.email || "none"}`);
    }
    notifyOwners({
      title: "Customer updated",
      body:
        parts.length > 0
          ? `${customer.name}: ${parts.join("; ")}`
          : customer.name,
      url: "/owner",
      tag: `customer:${id}:${Date.now()}`,
    });
    return NextResponse.json({ customer });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: { name: true },
    });
    await prisma.customer.delete({ where: { id } });
    notifyOwners({
      title: "Customer removed",
      body: existing?.name || "A customer was removed",
      url: "/owner",
      tag: `customer:${id}:${Date.now()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
