import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { upsertLocalCategory } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dropOp, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { readSnapshot } from "@/lib/local-db";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireRole(Role.OWNER);
    try {
      const categories = await prisma.category.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { products: true } } },
      });
      return NextResponse.json({ categories });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      return NextResponse.json({ categories: readSnapshot("categories") || [] });
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
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const category = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _count: { products: 0 },
    };
    upsertLocalCategory(category);
    try {
      await prisma.category.create({ data: { id: category.id, name } });
      dropOp(`category:${category.id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`category:${category.id}`, "category.upsert", {
        ...category,
        pendingCreate: true,
      });
    }
    void syncPendingSales();
    bustCache("categories", "products");
    notifyOwners({
      title: "Category added",
      body: name,
      url: "/items",
      tag: `category:${category.id}:${Date.now()}`,
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
