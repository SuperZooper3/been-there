"use client";

import { Suspense, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase-browser";

type View = "signin" | "signup" | "forgot" | "update";

const showcaseFrames = [
  {
    src: "/showcase/been-there-map.png",
    alt: "Been There map of San Francisco with visited cells and photo pins",
    title: "Fill the map",
    caption: "Paint real places as you go.",
    className: "xl:left-[2%] xl:top-[clamp(5rem,calc(50%_-_42rem),36rem)] xl:w-[330px] xl:-rotate-6 2xl:left-[5%] 2xl:top-[clamp(10rem,calc(50%_-_44rem),38rem)] 2xl:w-[420px]",
  },
  {
    src: "/showcase/been-there-polaroid.png",
    alt: "A Been There Polaroid photo memory opened on the map",
    title: "Pin memories",
    caption: "Photos become little map keepsakes.",
    className: "xl:right-[2%] xl:top-[clamp(6rem,calc(50%_-_40rem),38rem)] xl:w-[310px] xl:rotate-5 2xl:right-[6%] 2xl:top-[clamp(11rem,calc(50%_-_42rem),40rem)] 2xl:w-[390px]",
  },
  {
    src: "/showcase/been-there-intelligence.png",
    alt: "Been There intelligence mode heatmap over San Francisco",
    title: "Spot patterns",
    caption: "Recency and frequency overlays show your history.",
    className: "xl:left-[3%] xl:top-[clamp(32rem,calc(50%_-_20rem),58rem)] xl:w-[315px] xl:rotate-3 2xl:left-[6%] 2xl:top-[clamp(36rem,calc(50%_-_20rem),62rem)] 2xl:w-[400px]",
  },
  {
    src: "/showcase/been-there-region.png",
    alt: "Been There regional map showing visited areas across the Bay Area",
    title: "Zoom out",
    caption: "Neighborhoods, cities, and regions all stay readable.",
    className: "xl:right-[5%] xl:top-[clamp(45rem,calc(50%_-_4rem),74rem)] xl:w-[285px] xl:-rotate-4 2xl:right-[5%] 2xl:top-[clamp(58rem,calc(50%_+_8rem),88rem)] 2xl:w-[360px]",
  },
  {
    src: "/showcase/been-there-world.png",
    alt: "Been There continent-scale map showing visited areas across North America",
    title: "Watch it grow",
    caption: "Your explored world becomes a living record.",
    className: "xl:right-[6%] xl:top-[clamp(29rem,calc(50%_-_18rem),57rem)] xl:w-[210px] xl:rotate-4 2xl:right-[12%] 2xl:top-[clamp(34rem,calc(50%_-_15rem),64rem)] 2xl:w-[260px]",
  },
];

const featureHighlights = [
  {
    label: "Color real places",
    text: "Draw or track the streets, neighborhoods, and tiny detours you have actually explored.",
    accent: "#7ec8c8",
    tint: "rgba(126, 200, 200, 0.16)",
  },
  {
    label: "Keep photo pins",
    text: "Turn favorite photos into map memories, placed by hand or from GPS metadata.",
    accent: "#f0a0b0",
    tint: "rgba(240, 160, 176, 0.16)",
  },
  {
    label: "Read your history",
    text: "Use recency, frequency, and first-visited overlays when you want the bigger pattern.",
    accent: "#f0b878",
    tint: "rgba(240, 184, 120, 0.18)",
  },
];

function inputStyle(): CSSProperties {
  return {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text)",
  };
}

function LandingContent() {
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
  const [selectedFrame, setSelectedFrame] = useState<(typeof showcaseFrames)[number] | null>(null);

  useEffect(() => {
    if (searchParams.get("mode") === "update") setView("update");
  }, [searchParams]);

  useEffect(() => {
    if (!selectedFrame) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedFrame(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedFrame]);

  function reset() {
    setError(null);
    setSuccess(null);
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    reset();
    const redirectTo =
      `${window.location.origin}/auth/callback?next=${encodeURIComponent("/login?mode=update")}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) setError(error.message);
    else setSuccess("Check your email. We sent a password reset link.");
    setLoading(false);
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    reset();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <main
      className="min-h-dvh overflow-x-hidden"
      style={{
        background:
          "linear-gradient(180deg, var(--color-bg) 0%, #fbf8f4 52%, #edf7f5 100%)",
      }}
    >
      <section className="relative mx-auto flex min-h-dvh w-full max-w-[112rem] flex-col px-5 py-8 sm:px-8 lg:px-10 2xl:max-w-[132rem]">
        <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center">
          <div className="absolute inset-0 hidden xl:block">
            {showcaseFrames.map((frame) => (
              <ShowcaseCard
                key={frame.src}
                frame={frame}
                layout="sprinkle"
                onOpen={() => setSelectedFrame(frame)}
              />
            ))}
          </div>

          <section className="relative z-20 flex w-full max-w-[560px] flex-col items-center text-center">
            <Image
              src="/been-there-long.png"
              alt="Been There"
              width={3500}
              height={1100}
              priority
              sizes="(min-width: 640px) 300px, 230px"
              className="h-auto w-[230px] sm:w-[300px]"
            />
            <h1 className="mt-6 max-w-[560px] text-5xl font-black leading-[0.94] sm:text-6xl">
              Tis&apos; summer of sidequests.
            </h1>
            <p
              className="mt-4 max-w-[440px] text-base leading-7"
              style={{ color: "var(--color-text-muted)" }}
            >
              Map the places you&apos;ve actually been, pin memories where they
              happened, and watch your summer sidequests light up.
            </p>

            <div className="order-2 mt-5 grid w-full max-w-[620px] gap-2 sm:grid-cols-3 md:order-none">
              {featureHighlights.map((feature) => (
                <div
                  key={feature.label}
                  className="rounded-lg px-3 py-3 text-left"
                  style={{
                    background: feature.tint,
                    border: `1px solid ${feature.accent}55`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: feature.accent }}
                    />
                    <h2 className="text-sm font-bold leading-5">{feature.label}</h2>
                  </div>
                  <p
                    className="mt-2 text-xs leading-5"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {feature.text}
                  </p>
                </div>
              ))}
            </div>

            <AuthCard
              view={view}
              setView={setView}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              loading={loading}
              error={error}
              success={success}
              reset={reset}
              handleSignIn={handleSignIn}
              handleSignUp={handleSignUp}
              handleForgot={handleForgot}
              handleUpdate={handleUpdate}
            />

            <div
              className="order-3 mt-3 max-w-sm border-l-2 py-1 pl-4 text-left md:order-none"
              style={{
                borderColor: "var(--color-teal)",
              }}
            >
              <p className="text-sm font-semibold">Your map is yours.</p>
              <p
                className="mt-1 text-xs leading-5"
                style={{ color: "var(--color-text-muted)" }}
              >
                Not a social feed. Your map is for you. To make it work, Been
                There receives your location and stores it on our server so
                your private map can sync.
              </p>
            </div>
          </section>
        </div>

        <div className="grid gap-4 pb-8 sm:grid-cols-2 lg:grid-cols-3 xl:hidden">
          {showcaseFrames.map((frame) => (
            <ShowcaseCard
              key={frame.src}
              frame={frame}
              layout="grid"
              onOpen={() => setSelectedFrame(frame)}
            />
          ))}
        </div>
      </section>

      {selectedFrame && (
        <ImagePreviewModal
          frame={selectedFrame}
          onClose={() => setSelectedFrame(null)}
        />
      )}
    </main>
  );
}

function ShowcaseCard({
  frame,
  layout,
  onOpen,
}: {
  frame: (typeof showcaseFrames)[number];
  layout: "sprinkle" | "grid";
  onOpen: () => void;
}) {
  const baseClass =
    "group block rounded-md bg-white p-2 text-left shadow-[0_20px_55px_rgba(61,53,48,0.16)] ring-1 ring-black/10 transition duration-300 hover:-translate-y-1 hover:rotate-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7ec8c8]";
  const layoutClass =
    layout === "sprinkle"
      ? `absolute z-10 ${frame.className}`
      : "relative w-full";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${frame.title}`}
      className={`${baseClass} ${layoutClass}`}
    >
      <figure>
        <Image
          src={frame.src}
          alt={frame.alt}
          width={1600}
          height={1112}
          sizes={
            layout === "sprinkle"
              ? "320px"
              : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          }
          className="aspect-[1600/1112] w-full rounded object-cover"
        />
        <figcaption className="px-1 pb-1 pt-3">
          <span className="block text-sm font-bold">{frame.title}</span>
        </figcaption>
      </figure>
    </button>
  );
}

function ImagePreviewModal({
  frame,
  onClose,
}: {
  frame: (typeof showcaseFrames)[number];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#3d3530]/45 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="showcase-preview-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl rounded-lg bg-white p-3 shadow-[0_30px_100px_rgba(0,0,0,0.28)]"
        style={{ color: "var(--color-text)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-md transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7ec8c8]"
        >
          <X size={18} aria-hidden="true" />
        </button>
        <Image
          src={frame.src}
          alt={frame.alt}
          width={1600}
          height={1112}
          sizes="100vw"
          className="max-h-[70dvh] w-full rounded object-contain"
        />
        <div className="px-2 pb-2 pt-4">
          <h2 id="showcase-preview-title" className="text-xl font-black">
            {frame.title}
          </h2>
          <p className="mt-1 text-sm leading-6" style={{ color: "var(--color-text-muted)" }}>
            {frame.caption}
          </p>
        </div>
      </div>
    </div>
  );
}

function AuthCard({
  view,
  setView,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  loading,
  error,
  success,
  reset,
  handleSignIn,
  handleSignUp,
  handleForgot,
  handleUpdate,
}: {
  view: View;
  setView: (view: View) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  loading: boolean;
  error: string | null;
  success: string | null;
  reset: () => void;
  handleSignIn: (e: FormEvent) => Promise<void>;
  handleSignUp: (e: FormEvent) => Promise<void>;
  handleForgot: (e: FormEvent) => Promise<void>;
  handleUpdate: (e: FormEvent) => Promise<void>;
}) {
  const title = view === "update" ? "Set a new password" : "Start your map";
  const subtitle =
    view === "update"
      ? "Choose a new password to get back to your places."
      : "Sign in or make an account to save your own Been There map.";

  return (
    <div
      className="order-1 relative z-30 mx-auto mt-5 w-full max-w-sm rounded-lg p-5 shadow-[0_24px_70px_rgba(61,53,48,0.2)] md:order-none"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <h2 className="text-2xl font-black">{title}</h2>
      <p className="mb-6 mt-2 text-sm leading-6" style={{ color: "var(--color-text-muted)" }}>
        {subtitle}
      </p>

      {view === "signin" && (
        <form onSubmit={handleSignIn}>
          <Field label="Email" id="email" type="email" value={email} onChange={setEmail} />
          <Field label="Password" id="password" type="password" value={password} onChange={setPassword} />
          <Submit loading={loading} label="Sign in" />
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                setView("forgot");
              }}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--color-text-muted)" }}
            >
              Forgot password?
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setView("signup");
              }}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: "var(--color-text-muted)" }}
            >
              Need an account? Sign up
            </button>
          </div>
        </form>
      )}

      {view === "signup" && (
        <form onSubmit={handleSignUp}>
          <Field label="Email" id="email" type="email" value={email} onChange={setEmail} />
          <Field label="Password" id="password" type="password" value={password} onChange={setPassword} />
          <Submit loading={loading} label="Sign up" />
          <button
            type="button"
            onClick={() => {
              reset();
              setView("signin");
            }}
            className="mt-4 w-full text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--color-text-muted)" }}
          >
            Already have an account? Sign in
          </button>
        </form>
      )}

      {view === "forgot" && (
        <form onSubmit={handleForgot}>
          <p className="mb-4 text-xs leading-5" style={{ color: "var(--color-text-muted)" }}>
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
          <Field label="Email" id="email" type="email" value={email} onChange={setEmail} />
          {success ? (
            <p className="py-3 text-center text-sm" style={{ color: "#2d7a4f" }}>
              {success}
            </p>
          ) : (
            <Submit loading={loading} label="Send reset link" />
          )}
          <button
            type="button"
            onClick={() => {
              reset();
              setView("signin");
            }}
            className="mt-4 w-full text-xs transition-opacity hover:opacity-70"
            style={{ color: "var(--color-text-muted)" }}
          >
            Back to sign in
          </button>
        </form>
      )}

      {view === "update" && (
        <form onSubmit={handleUpdate}>
          <Field
            label="New password"
            id="password"
            type="password"
            value={password}
            onChange={setPassword}
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
        <p className="mt-4 text-xs leading-5" style={{ color: "#c0392b" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  id,
  type,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  id: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <label htmlFor={id} className="mb-1.5 block text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        autoFocus={autoFocus}
        placeholder={type === "email" ? "you@example.com" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mb-4 w-full rounded-lg px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[#7ec8c8]"
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
      className="w-full rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:opacity-50"
      style={{ background: "var(--color-teal)", color: "var(--color-text)" }}
    >
      {loading ? "Loading..." : label}
    </button>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingContent />
    </Suspense>
  );
}
