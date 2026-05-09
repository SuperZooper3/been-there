"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";

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

type Props = {
  onClose: () => void;
};

/**
 * First-launch tips for Capacitor builds: notifications (Android 13+) and OEM battery limits.
 */
export default function NativeOnboardingModal({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const isAndroid = Capacitor.getPlatform() === "android";

  async function requestNotificationPermission() {
    if (!isAndroid) return;
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.requestPermissions();
    } catch {
      /* WebView or older Android — still continue */
    }
  }

  function finish() {
    markNativeOnboardingComplete();
    onClose();
  }

  return (
    <div
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
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              When you tap <strong>Track</strong>, we use your GPS to paint hex cells you pass through — including while
              the screen is off. Android shows a small ongoing alert so the system allows that.
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
              Notifications &amp; battery
            </p>
            {isAndroid ? (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
                On <strong>Android 13 and newer</strong>, the system only shows our tracking notification if you allow
                notifications for Been There. Tap below to open the permission prompt (you can also allow it later in
                system Settings).
              </p>
            ) : (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
                iOS shows a blue location indicator while tracking runs in the background.
              </p>
            )}
            {isAndroid && (
              <button
                type="button"
                onClick={requestNotificationPermission}
                style={{
                  width: "100%",
                  marginBottom: 12,
                  padding: "10px 0",
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Ask for notification permission
              </button>
            )}
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              On <strong>Samsung, Xiaomi, Huawei, and OnePlus</strong>, aggressive battery savers can stop background
              tracking even with a notification. If cells stop updating after a few minutes, open{" "}
              <strong>Settings → Apps → Been There → Battery</strong> and set it to <strong>Unrestricted</strong> (wording
              varies by phone).
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
              Location access
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              When you start tracking, Android will ask for location. Choose <strong>Allow all the time</strong> if you
              want cells to paint while the phone is locked. <strong>While using the app</strong> only updates when Been
              There is open.
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
