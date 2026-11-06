import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import { forgetLocalCategory, upsertLocalCategory } from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dropOp, queueDelete, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    let previous = name;
    try {
      const found = await prisma.category.findUnique({
        where: { id },
        select: { name: true },
      });
      if (found) previous = found.name;
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
    }

    const category = {
      id,
      name,
      updatedAt: new Date().toISOString(),
    };
    upsertLocalCategory(category);
    try {
      await prisma.category.update({ where: { id }, data: { name } });
      dropOp(`category:${id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`category:${id}`, "category.upsert", category);
    }
    void syncPendingSales();
    bustCache("categories", "products");
    notifyOwners({
      title: "Category updated",
      body: previous === name ? name : `${previous} → ${name}`,
      url: "/items",
      tag: `category:${id}:${Date.now()}`,
    });
    return NextResponse.json({ category });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    let name = "A category";
    try {
      const found = await prisma.category.findUnique({
        where: { id },
        select: { name: true },
      });
      if (found) name = found.name;
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
    }
    try {
      await prisma.category.delete({ where: { id } });
    } catch (error) {
      const missing =
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "P2025";
      if (!missing) {
        if (!isDbUnavailable(error)) throw error;
        queueDelete(`category:${id}`, "category.delete", { id });
      }
    }
    forgetLocalCategory(id);
    void syncPendingSales();
    bustCache("categories", "products");
    notifyOwners({
      title: "Category removed",
      body: name,
      url: "/items",
      tag: `category:${id}:${Date.now()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
