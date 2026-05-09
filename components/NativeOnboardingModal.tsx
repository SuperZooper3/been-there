"use client";

import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin, type PermissionState } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Geolocation } from "@capacitor/geolocation";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const STORAGE_KEY = "been_there_native_onboarding_v2";

export function hasCompletedNativeOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markNativeOnboardingComplete(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function formatPerm(s: PermissionState | string | undefined): string {
  if (s === "granted") return "allowed";
  if (s === "denied") return "blocked";
  if (s === "prompt" || s === "prompt-with-rationale") return "not set yet";
  return s ? String(s) : "unknown";
}

type Props = {
  onClose: () => void;
};

/**
 * Native shell: permissions, battery, tracking notification behavior. Re-open anytime from the header logo.
 */
export default function NativeOnboardingModal({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const isAndroid = Capacitor.getPlatform() === "android";
  const [notifDisplay, setNotifDisplay] = useState<PermissionState | "">("");
  const [locFine, setLocFine] = useState<PermissionState | "">("");

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const loc = await Geolocation.checkPermissions();
      setLocFine(loc.location ?? "");
    } catch {
      setLocFine("");
    }
    if (Capacitor.getPlatform() === "android") {
      try {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const n = await LocalNotifications.checkPermissions();
        setNotifDisplay(n.display ?? "");
      } catch {
        setNotifDisplay("");
      }
    } else {
      setNotifDisplay("");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, step]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let sub: Awaited<ReturnType<typeof App.addListener>> | undefined;
    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refresh();
    }).then((h) => {
      sub = h;
    });
    return () => {
      void sub?.remove();
    };
  }, [refresh]);

  async function requestNotificationPermission() {
    if (!isAndroid) return;
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.requestPermissions();
    } catch {
      /* ignore */
    }
    await refresh();
  }

  async function requestLocationPermission() {
    try {
      await Geolocation.requestPermissions();
    } catch {
      /* ignore */
    }
    await refresh();
  }

  function openAppSettings() {
    void BackgroundGeolocation.openSettings();
  }

  function finish() {
    markNativeOnboardingComplete();
    onClose();
  }

  const notifLabel = isAndroid ? `Notifications — ${formatPerm(notifDisplay)}` : "";
  const locLabel = `Location — ${formatPerm(locFine)}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 400,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 20,
          padding: "24px 22px 20px",
          maxWidth: 360,
          width: "100%",
          boxShadow: "0 12px 48px rgba(0,0,0,0.2)",
        }}
      >
        {step === 0 && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
              Been There on your phone
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              When you tap <strong>Track</strong>, we use your GPS to paint hex cells you pass through — including while
              the screen is off. Android needs a small <strong>ongoing</strong> notification for that (it stays in the
              shade, is <strong>silent</strong>, and normally <strong>can&apos;t be swiped away</strong> while recording — that&apos;s
              required so the OS doesn&apos;t kill tracking).
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Tip: tap the <strong>Been There</strong> logo in the corner anytime to reopen this guide and check permission
              status.
            </p>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                border: "none",
                background: "var(--color-teal)",
                color: "var(--color-text)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              Next
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
              {isAndroid ? "Notifications & battery" : "Location & battery"}
            </p>

            {isAndroid && (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.45 }}>
                  Android 13+ needs notification permission so the tracking alert can appear (silent, no sound per ping).
                </p>
                <button
                  type="button"
                  onClick={notifDisplay === "denied" ? openAppSettings : requestNotificationPermission}
                  style={{
                    width: "100%",
                    marginBottom: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${notifDisplay === "granted" ? "rgba(72,187,120,0.5)" : "var(--color-border)"}`,
                    background: notifDisplay === "granted" ? "rgba(72,187,120,0.1)" : "transparent",
                    color: "var(--color-text)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    touchAction: "manipulation",
                  }}
                >
                  {notifLabel}
                  {notifDisplay === "denied" ? " — open app settings" : notifDisplay === "granted" ? "" : " — tap to allow"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={locFine === "denied" ? openAppSettings : requestLocationPermission}
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${locFine === "granted" ? "rgba(72,187,120,0.5)" : "var(--color-border)"}`,
                background: locFine === "granted" ? "rgba(72,187,120,0.1)" : "transparent",
                color: "var(--color-text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                touchAction: "manipulation",
              }}
            >
              {locLabel}
              {locFine === "denied" ? " — open app settings" : locFine === "granted" ? "" : " — tap to allow"}
            </button>

            <button
              type="button"
              onClick={() => void refresh()}
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "8px 0",
                borderRadius: 10,
                border: "1px dashed var(--color-border)",
                background: "transparent",
                color: "var(--color-text-muted)",
                fontSize: 12,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              Refresh status
            </button>

            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              On <strong>Samsung, Xiaomi, Huawei, and OnePlus</strong>, set{" "}
              <strong>Settings → Apps → Been There → Battery → Unrestricted</strong> if tracking stops in the background.
            </p>

            <button
              type="button"
              onClick={() => (isAndroid ? setStep(2) : finish())}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                border: "none",
                background: "var(--color-teal)",
                color: "var(--color-text)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              {isAndroid ? "Next" : "Got it"}
            </button>
          </>
        )}

        {step === 2 && isAndroid && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
              All-the-time location
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              When you start <strong>Track</strong>, choose <strong>Allow all the time</strong> if you want cells while the
              phone is locked. <strong>Only while using the app</strong> updates when Been There is on screen.
            </p>
            <button
              type="button"
              onClick={finish}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 12,
                border: "none",
                background: "var(--color-teal)",
                color: "var(--color-text)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                touchAction: "manipulation",
              }}
            >
              Got it — open map
            </button>
          </>
        )}
      </div>
    </div>
  );
}
