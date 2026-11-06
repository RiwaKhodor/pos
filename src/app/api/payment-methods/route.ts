import { NextResponse } from "next/server";
import { authErrorResponse, requireAuth, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { bustCache, getCachedPaymentMethods } from "@/lib/data-cache";
import { isDbUnavailable } from "@/lib/db-unavailable";
import {
  readPaymentMethods,
  upsertLocalPaymentMethod,
} from "@/lib/catalog-cache";
import { localDb } from "@/lib/local-db";
import { dropOp, queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";
import { notifyOwners } from "@/lib/push";

export async function GET() {
  try {
    await requireAuth();
    const stored = localDb()
      .prepare("SELECT COUNT(*) AS n FROM payment_methods")
      .get() as { n: number };
    if (stored.n > 0) {
      return NextResponse.json({ methods: readPaymentMethods() });
    }
    try {
      const all = await getCachedPaymentMethods();
      const methods = all.filter((m) => m.active);
      return NextResponse.json({ methods });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      return NextResponse.json({ methods: readPaymentMethods() });
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

    const method = {
      id: crypto.randomUUID(),
      name,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalPaymentMethod(method);
    try {
      await prisma.paymentMethod.create({
        data: { id: method.id, name, active: true },
      });
      dropOp(`payment:${method.id}`);
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`payment:${method.id}`, "payment.upsert", {
        ...method,
        pendingCreate: true,
      });
    }
    void syncPendingSales();
    bustCache("payment-methods");
    notifyOwners({
      title: "Payment method added",
      body: name,
      url: "/owner",
      tag: `payment:${method.id}:${Date.now()}`,
    });
    return NextResponse.json({ method }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
