import * as webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { localDb } from "@/lib/local-db";

export type PushNotice = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type StoredPush = {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
};

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:owner@store.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export function saveLocalPush(row: StoredPush & { userAgent?: string | null }) {
  localDb()
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`
    )
    .run(
      row.endpoint,
      row.userId,
      row.p256dh,
      row.auth,
      row.userAgent || null,
      new Date().toISOString()
    );
}

export function deleteLocalPush(endpoint: string) {
  localDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

function readLocalPush(): StoredPush[] {
  return localDb()
    .prepare(
      "SELECT endpoint, user_id AS userId, p256dh, auth FROM push_subscriptions"
    )
    .all() as StoredPush[];
}

function queueNotice(notice: PushNotice) {
  localDb()
    .prepare(
      "INSERT INTO push_outbox (id, payload_json, created_at) VALUES (?, ?, ?)"
    )
    .run(crypto.randomUUID(), JSON.stringify(notice), new Date().toISOString());
}

async function loadSubscriptions(): Promise<StoredPush[]> {
  const byEndpoint = new Map<string, StoredPush>();
  for (const row of readLocalPush()) byEndpoint.set(row.endpoint, row);
  try {
    const remote = await prisma.pushSubscription.findMany({
      select: { endpoint: true, userId: true, p256dh: true, auth: true },
    });
    for (const row of remote) byEndpoint.set(row.endpoint, row);
  } catch (error) {
    console.error(error);
  }
  return [...byEndpoint.values()];
}

async function removeSubscription(endpoint: string) {
  deleteLocalPush(endpoint);
  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  } catch (error) {
    console.error(error);
  }
}

async function sendNotice(notice: PushNotice) {
  const keys = vapid();
  if (!keys) return "skipped" as const;
  const subscriptions = await loadSubscriptions();
  if (subscriptions.length === 0) return "skipped" as const;
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const payload = JSON.stringify({
    title: notice.title,
    body: notice.body,
    url: notice.url || "/owner",
    tag: notice.tag || "pos",
  });
  let sent = 0;
  let networkFailed = false;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await removeSubscription(subscription.endpoint);
      } else if (!status) {
        networkFailed = true;
        console.error(error);
      } else {
        console.error(error);
      }
    }
  }
  if (sent === 0 && networkFailed) return "offline" as const;
  return "sent" as const;
}

export function notifyOwners(notice: PushNotice) {
  void sendNotice(notice)
    .then((result) => {
      if (result === "offline") queueNotice(notice);
    })
    .catch((error) => {
      console.error(error);
      queueNotice(notice);
    });
}

export async function flushPushOutbox() {
  const rows = localDb()
    .prepare("SELECT id, payload_json FROM push_outbox ORDER BY created_at ASC")
    .all() as { id: string; payload_json: string }[];
  for (const row of rows) {
    const notice = JSON.parse(row.payload_json) as PushNotice;
    const result = await sendNotice(notice);
    if (result !== "offline") {
      localDb().prepare("DELETE FROM push_outbox WHERE id = ?").run(row.id);
    }
  }
}
