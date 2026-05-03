"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
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
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--color-bg)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-md"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h1
          className="text-2xl font-semibold mb-1"
          style={{ color: "var(--color-text)" }}
        >
          Been There
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--color-text-muted)" }}>
          Fill out the map by visiting places.
        </p>

        {sent ? (
          <div>
            <p className="text-sm mb-2" style={{ color: "var(--color-text)" }}>
              Check your email for a sign-in link.
            </p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Sent to {email}. You can close this tab.
            </p>
          </div>
        ) : (
          <form onSubmit={signIn}>
            <label
              htmlFor="email"
              className="block text-xs mb-1.5"
              style={{ color: "var(--color-text-muted)" }}
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl py-2.5 px-4 text-sm mb-4 outline-none"
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
                background: "var(--color-teal)",
                color: "var(--color-text)",
              }}
            >
              {loading ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
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
