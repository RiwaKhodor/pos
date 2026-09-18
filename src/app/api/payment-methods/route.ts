import { NextResponse } from "next/server";
import { authErrorResponse, requireAuth, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireAuth();
    const methods = await prisma.paymentMethod.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ methods });
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

    const method = await prisma.paymentMethod.create({
      data: { name, active: true },
    });
    return NextResponse.json({ method }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
