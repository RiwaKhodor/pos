"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Sale = { id: string; receiptNumber: string; total: number; createdAt: string };
type Expense = { id: string; note: string; amount: number; date: string };
type Item = { id: string; name: string; price: number; stock: number; updatedAt: string };
type Feed = { sales: Sale[]; expenses: Expense[]; items: Item[] };

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function noticesFor(previous: Feed, next: Feed) {
  const notes: { title: string; body: string; url: string }[] = [];
  const previousSales = new Set(previous.sales.map((sale) => sale.id));
  const nextSales = new Set(next.sales.map((sale) => sale.id));
  const addedSales = next.sales.filter((sale) => !previousSales.has(sale.id));
  for (const sale of addedSales) {
    notes.push({
      title: "New sale",
      body: `Receipt ${sale.receiptNumber} · ${money(sale.total)}`,
      url: `/receipts/${sale.id}`,
    });
  }
  const pushedOff = addedSales.length > 0 && next.sales.length >= 8;
  if (!pushedOff) {
    for (const sale of previous.sales) {
      if (nextSales.has(sale.id)) continue;
      notes.push({
        title: "Refund",
        body: `Receipt ${sale.receiptNumber} · ${money(sale.total)} was removed`,
        url: "/sales",
      });
    }
  }

  const previousExpenses = new Set(previous.expenses.map((row) => row.id));
  const nextExpenses = new Set(next.expenses.map((row) => row.id));
  for (const row of next.expenses) {
    if (previousExpenses.has(row.id)) continue;
    notes.push({
      title: "Expense added",
      body: `${row.note} · ${money(row.amount)}`,
      url: "/expenses",
    });
  }
  if (next.expenses.length < 40) {
    for (const row of previous.expenses) {
      if (nextExpenses.has(row.id)) continue;
      notes.push({
        title: "Expense removed",
        body: `${row.note} · ${money(row.amount)}`,
        url: "/expenses",
      });
    }
  }

  const previousItems = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of next.items) {
    const before = previousItems.get(item.id);
    if (!before) {
      notes.push({
        title: "Item updated",
        body: `${item.name} · stock ${item.stock} · ${money(item.price)}`,
        url: "/items",
      });
      continue;
    }
    const parts: string[] = [];
    if (Number(before.price) !== Number(item.price)) {
      parts.push(`price ${money(before.price)} → ${money(item.price)}`);
    }
    if (Number(before.stock) !== Number(item.stock)) {
      parts.push(`stock ${before.stock} → ${item.stock}`);
    }
    if (parts.length === 0) continue;
    notes.push({
      title: parts.some((part) => part.startsWith("price")) ? "Price change" : "Stock change",
      body: `${item.name}: ${parts.join("; ")}`,
      url: "/items",
    });
  }
  return notes.slice(0, 4);
}

async function showNotice(title: string, body: string, url: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const tag = `${title}:${Date.now()}`;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        tag,
        data: { url },
      });
      return;
    }
  } catch {
    // The page notification below still shows the change.
  }
  new Notification(title, { body, tag });
}

export function LiveStore() {
  const router = useRouter();
  const previous = useRef<Feed | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    async function look() {
      if (stopped || running.current) return;
      running.current = true;
      try {
        const response = await fetch("/api/owner/feed", { cache: "no-store" });
        if (!response.ok) return;
        const feed = (await response.json()) as Feed;
        feed.sales = Array.isArray(feed.sales) ? feed.sales : [];
        feed.expenses = Array.isArray(feed.expenses) ? feed.expenses : [];
        feed.items = Array.isArray(feed.items) ? feed.items : [];
        const last = previous.current;
        previous.current = feed;
        if (!last) return;
        const notes = noticesFor(last, feed);
        if (notes.length === 0) return;
        router.refresh();
        for (const note of notes) {
          void showNotice(note.title, note.body, note.url);
        }
      } catch {
        // The next check tries again.
      } finally {
        running.current = false;
      }
    }

    function schedule() {
      window.clearInterval(timer);
      timer = window.setInterval(look, document.hidden ? 20000 : 8000);
    }

    function onVisible() {
      schedule();
      void look();
    }

    void look();
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
