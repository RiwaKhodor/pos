"use client";

import { useState } from "react";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function NotificationSettings() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setError("This phone browser cannot receive notifications.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notifications stay off until this phone allows them.");
        return;
      }
      const keyRes = await fetch("/api/push/public-key");
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.publicKey) {
        setError("Notifications are not ready on this server yet.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
      const saved = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!saved.ok && saved.status < 500) {
        const data = await saved.json().catch(() => ({}));
        setError(data.error || "Could not save notifications.");
        return;
      }
      if (!saved.ok) {
        setMessage("Saved on this phone. It will finish when the connection returns.");
        return;
      }
      setMessage("Notifications are on for this phone.");
    } catch {
      setError("Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/push/subscribe", { method: "PUT" });
      if (!res.ok && res.status < 500) {
        setError("Could not send a test notification.");
        return;
      }
      setMessage("Test sent. If this phone is allowed, the alert appears in a moment.");
    } catch {
      setError("Could not send a test notification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk-panel">
      <div className="mb-3 text-sm font-bold">Notifications</div>
      <p className="mb-4 max-w-xl text-sm">
        Turn this on from the owner phone. Sales, receipts, stock changes, item
        updates, price changes, and refunds can then alert this phone.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="desk-btn" disabled={busy} onClick={enable}>
          Enable notifications
        </button>
        <button type="button" className="desk-btn" disabled={busy} onClick={sendTest}>
          Send test
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
