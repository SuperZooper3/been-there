"use client";

import { useState, useEffect, Suspense } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { useRouter, useSearchParams } from "next/navigation";

type View = "signin" | "signup" | "forgot" | "update";

function inputStyle(): React.CSSProperties {
  return {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text)",
  };
}

function LoginForm() {
  const supabase = createBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<View>(() =>
    searchParams.get("mode") === "update" ? "update" : "signin"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sync view if URL param changes (e.g. after reset-link redirect)
  useEffect(() => {
    if (searchParams.get("mode") === "update") setView("update");
  }, [searchParams]);

  function reset() {
    setError(null);
    setSuccess(null);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else { router.push("/"); router.refresh(); }
    setLoading(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else { router.push("/"); router.refresh(); }
    setLoading(false);
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const redirectTo =
      `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login?mode=update")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) setError(error.message);
    else setSuccess("Check your email — we sent a password reset link.");
    setLoading(false);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    reset();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else { router.push("/"); router.refresh(); }
    setLoading(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--color-bg)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-md"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/been-there-long.png"
            alt="Been There"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
        <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
          {view === "update" ? "Choose a new password." : "Fill out the map by visiting places."}
        </p>

        {/* ── Sign in ── */}
        {view === "signin" && (
          <form onSubmit={handleSignIn}>
            <Field label="Email" id="email" type="email" value={email} onChange={setEmail} autoFocus />
            <Field label="Password" id="password" type="password" value={password} onChange={setPassword} />
            <Submit loading={loading} label="Sign in" />
            <div className="flex flex-col items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => { reset(); setView("forgot"); }}
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: "var(--color-text-muted)" }}
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => { reset(); setView("signup"); }}
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: "var(--color-text-muted)" }}
              >
                Need an account? Sign up
              </button>
            </div>
          </form>
        )}

        {/* ── Sign up ── */}
        {view === "signup" && (
          <form onSubmit={handleSignUp}>
            <Field label="Email" id="email" type="email" value={email} onChange={setEmail} autoFocus />
            <Field label="Password" id="password" type="password" value={password} onChange={setPassword} />
            <Submit loading={loading} label="Sign up" />
            <button
              type="button"
              onClick={() => { reset(); setView("signin"); }}
              className="w-full mt-3 text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--color-text-muted)" }}
            >
              Already have an account? Sign in
            </button>
          </form>
        )}

        {/* ── Forgot password ── */}
        {view === "forgot" && (
          <form onSubmit={handleForgot}>
            <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
            <Field label="Email" id="email" type="email" value={email} onChange={setEmail} autoFocus />
            {success ? (
              <p className="text-sm py-3 text-center" style={{ color: "#2d7a4f" }}>{success}</p>
            ) : (
              <Submit loading={loading} label="Send reset link" />
            )}
            <button
              type="button"
              onClick={() => { reset(); setView("signin"); }}
              className="w-full mt-3 text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--color-text-muted)" }}
            >
              Back to sign in
            </button>
          </form>
        )}

        {/* ── Update password ── */}
        {view === "update" && (
          <form onSubmit={handleUpdate}>
            <Field
              label="New password"
              id="password"
              type="password"
              value={password}
              onChange={setPassword}
              autoFocus
            />
            <Field
              label="Confirm new password"
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <Submit loading={loading} label="Set new password" />
          </form>
        )}

        {error && (
          <p className="mt-4 text-xs" style={{ color: "#c0392b" }}>{error}</p>
        )}
      </div>
    </div>
  );
}

// ── Small shared sub-components ──

function Field({
  label, id, type, value, onChange, autoFocus,
}: {
  label: string;
  id: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <label htmlFor={id} className="block text-xs mb-1.5" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        autoFocus={autoFocus}
        placeholder={type === "email" ? "you@example.com" : "••••••••"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl py-2.5 px-4 text-sm mb-4 outline-none"
        style={inputStyle()}
      />
    </>
  );
}

function Submit({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-xl py-2.5 px-4 text-sm font-medium transition-opacity disabled:opacity-50"
      style={{ background: "var(--color-teal)", color: "var(--color-text)" }}
    >
      {loading ? "Loading…" : label}
    </button>
  );
}

// Wrap in Suspense because useSearchParams() requires it in Next.js App Router
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
