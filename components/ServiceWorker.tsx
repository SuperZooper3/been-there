"use client";

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Check for updates every time the app is focused
        reg.update().catch(() => {});
      })
      .catch((err) => console.warn("SW registration failed:", err));
  }, []);

  return null;
}
