import { prisma } from "@/lib/prisma";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { Role } from "@/lib/roles";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { deleteLocalPush, notifyOwners, saveLocalPush } from "@/lib/push";
import { queueOp } from "@/lib/offline-ops";
import { syncPendingSales } from "@/lib/sync-sales";

type PushBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

function readSubscription(body: PushBody) {
  const endpoint = String(body.endpoint || "");
  const p256dh = String(body.keys?.p256dh || "");
  const auth = String(body.keys?.auth || "");
  if (!endpoint.startsWith("https://") || endpoint.length > 2000 || !p256dh || !auth) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

export async function POST(request: Request) {
  try {
    const user = await requireRole(Role.OWNER);
    const body = (await request.json()) as PushBody;
    const subscription = readSubscription(body);
    if (!subscription) {
      return Response.json({ error: "Invalid notification subscription" }, { status: 400 });
    }
    const userAgent = request.headers.get("user-agent");
    saveLocalPush({ ...subscription, userId: user.id, userAgent });
    try {
      await prisma.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        update: {
          userId: user.id,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          userAgent,
        },
        create: {
          userId: user.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          userAgent,
        },
      });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`push:${subscription.endpoint}`, "push.subscribe", {
        ...subscription,
        userId: user.id,
        userAgent,
      });
      void syncPendingSales();
      return Response.json({ ok: true, offline: true });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireRole(Role.OWNER);
    const body = (await request.json().catch(() => ({}))) as PushBody;
    const endpoint = String(body.endpoint || "");
    if (!endpoint.startsWith("https://")) {
      return Response.json({ error: "Invalid notification subscription" }, { status: 400 });
    }
    deleteLocalPush(endpoint);
    try {
      await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    } catch (error) {
      if (!isDbUnavailable(error)) throw error;
      queueOp(`push:${endpoint}`, "push.unsubscribe", { endpoint });
      void syncPendingSales();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT() {
  try {
    await requireRole(Role.OWNER);
    notifyOwners({
      title: "POS",
      body: "Notifications are on for this phone.",
      url: "/owner",
      tag: "push-test",
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
