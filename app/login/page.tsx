"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function signInWithMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-md"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--color-text)" }}>
          Been There
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
          Fill out the map by visiting places.
        </p>

        {sent ? (
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            Check your email for a magic link to sign in.
          </p>
        ) : (
          <>
            <button
              onClick={signInWithGoogle}
              disabled={loading}
              className="w-full rounded-xl py-2.5 px-4 text-sm font-medium mb-4 transition-opacity disabled:opacity-50"
              style={{
                background: "var(--color-teal)",
                color: "var(--color-text)",
              }}
            >
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                or
              </span>
              <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
            </div>

            <form onSubmit={signInWithMagicLink}>
              <input
                type="email"
                required
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl py-2.5 px-4 text-sm mb-3 outline-none"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-2.5 px-4 text-sm font-medium transition-opacity disabled:opacity-50"
                style={{
                  background: "var(--color-orange)",
                  color: "var(--color-text)",
                }}
              >
                Send magic link
              </button>
            </form>
          </>
        )}

        {error && (
          <p className="mt-4 text-xs" style={{ color: "#c0392b" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
