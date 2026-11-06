import { NextResponse } from "next/server";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache } from "@/lib/data-cache";
import {
  upsertLocalPaymentMethod,
} from "@/lib/catalog-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dropOp, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { readSnapshot } from "@/lib/local-db";
import { notifyOwners } from "@/lib/push";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const body = await request.json();

    const data: { name?: string; active?: boolean } = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.active !== undefined) data.active = Boolean(body.active);

    const current = await prisma.paymentMethod.findUnique({ where: { id } }).catch((error) => {
      if (!isDbUnavailable(error)) throw error;
      return null;
    });
    const listed = (
      readSnapshot<
        { id: string; name: string; active: boolean }[]
      >("payment-methods") || []
    ).find((method) => method.id === id);
    const local = listed;
    const method = {
      id,
      name: data.name || current?.name || local?.name || "",
      active: data.active ?? current?.active ?? local?.active ?? true,
      createdAt: current?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalPaymentMethod(method);
    try {
      await prisma.paymentMethod.update({ where: { id }, data });
      dropOp(`payment:${id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`payment:${id}`, "payment.upsert", method);
    }
    void syncPendingSales();
    bustCache("payment-methods");
    const previousName = current?.name || local?.name || method.name;
    const parts: string[] = [];
    if (data.name && data.name !== previousName) {
      parts.push(`name ${previousName} → ${method.name}`);
    }
    if (
      data.active !== undefined &&
      data.active !== (current?.active ?? local?.active)
    ) {
      parts.push(method.active ? "enabled" : "disabled");
    }
    notifyOwners({
      title: "Payment method updated",
      body: parts.length > 0 ? `${method.name}: ${parts.join("; ")}` : method.name,
      url: "/owner",
      tag: `payment:${id}:${Date.now()}`,
    });
    return NextResponse.json({ method });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole(Role.OWNER);
    const { id } = await params;
    const local = (
      readSnapshot<{ id: string; name: string; active: boolean }[]>("payment-methods") || []
    ).find((item) => item.id === id);
    const method = {
      id,
      name: local?.name || "",
      active: false,
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = await prisma.paymentMethod.update({
        where: { id },
        data: { active: false },
      });
      method.name = saved.name;
      dropOp(`payment:${id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`payment:${id}`, "payment.upsert", method);
    }
    upsertLocalPaymentMethod(method);
    void syncPendingSales();
    bustCache("payment-methods");
    notifyOwners({
      title: "Payment method removed",
      body: method.name || "A payment method was turned off",
      url: "/owner",
      tag: `payment:${id}:${Date.now()}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
