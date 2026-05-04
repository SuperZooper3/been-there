"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const supabase = createBrowserClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) {
        setError(error.message);
      } else {
        router.push("/");
        router.refresh();
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
      } else {
        router.push("/");
        router.refresh();
      }
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

        <form onSubmit={handleAuth}>
          <label
            htmlFor="email"
            className="block text-xs mb-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Email
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
          <label
            htmlFor="password"
            className="block text-xs mb-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            {loading ? "Loading…" : isSignUp ? "Sign up" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full mt-3 text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--color-text-muted)" }}
          >
            {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-xs" style={{ color: "#c0392b" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
