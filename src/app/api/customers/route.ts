import { NextResponse } from "next/server";
import { authErrorResponse, requireAuth, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { notifyOwners } from "@/lib/push";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";

    // Employees can look up customers for completing a sale
    const customers = await prisma.customer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { name: "asc" },
      take: user.role === Role.OWNER ? 200 : 20,
    });

    return NextResponse.json({ customers });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const customer = await prisma.customer.create({
      data: {
        name,
        email: body.email ? String(body.email).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
      },
    });

    notifyOwners({
      title: "Customer added",
      body: customer.phone ? `${name} · ${customer.phone}` : name,
      url: "/owner",
      tag: `customer:${customer.id}:${Date.now()}`,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
