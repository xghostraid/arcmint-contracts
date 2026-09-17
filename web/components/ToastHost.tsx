"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; title: string; body: string };

let pushToast: ((title: string, body: string) => void) | null = null;

export function showToast(title: string, body: string) {
  pushToast?.(title, body);
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      /* ignore */
    }
  }
}

export function requestLaunchNotifications() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    pushToast = (title, body) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, title, body }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 7000);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <p className="toast-title">{t.title}</p>
          <p className="toast-body">{t.body}</p>
        </div>
      ))}
    </div>
  );
}
