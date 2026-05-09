# Native App Direction: Decision Record

## The problem

`navigator.geolocation` is suspended by iOS and Android at the OS level when the browser tab or PWA is backgrounded. There is no web API workaround — no service worker trick, no manifest flag, nothing. Background location tracking requires a native process registered with the OS. Going native is the only fix.

---

## Options considered

### Option A: Capacitor

Wraps the existing Next.js/React app in a native `WKWebView` (iOS) / `WebView` (Android) shell. The full app runs inside that shell, unchanged. On the web, nothing changes — Vercel deployment continues as-is. Native plugins bridge JS calls to OS APIs for background location.

### Option B: React Native (with Expo)

Rewrites the UI using React Native components rendered natively (not in a WebView). React Native Web adds browser support by cross-compiling the same component tree to HTML.

---

## Comparison

### Background geolocation (the core need)

Both solve background tracking on iOS and Android. Neither gives background location on the web — that is an OS-level impossibility regardless of framework. On native, the solution is `@capacitor-community/background-geolocation` (Capacitor, MIT licensed, free) or `expo-location` + `expo-task-manager` (React Native, free).

### Web and desktop browser support

**Capacitor**: The web app is 100% unchanged. Vercel deployment is untouched. Desktop and mobile browsers continue working as they do today.

**React Native**: Requires React Native Web, which cross-compiles the RN component tree to HTML. It works but it is not "the same app" — it is a different rendering target. MapLibre is the critical issue here: `maplibre-react-native` (native) and `react-map-gl`/`maplibre-gl` (web) are different libraries with different APIs. The H3 GeoJSON layer, hex painting, and pin clustering code would need to be written twice and abstracted behind a platform shim.

### Code changes to reach feature parity

**Capacitor**: ~50-100 lines changed — install `@capacitor/core`, write `capacitor.config.ts` pointing to the Vercel URL, add platform-detection in `MapApp.tsx` to swap the GPS polling loop for the plugin's event listener. No UI components touched. No API routes touched. No Next.js config touched.

**React Native**: ~4,000-6,000 lines new or rewritten. Every UI component, the routing layer (Next.js → Expo Router), the style system (Tailwind → NativeWind or StyleSheet), and the map layer all need to be rebuilt. It is effectively a new app.

### MapLibre

**Capacitor**: MapLibre GL JS is a WebGL renderer running in a `<canvas>` inside the WebView — exactly what it does in a browser. Zero changes.

**React Native**: `maplibre-react-native` on native and `react-map-gl` on web are separate libraries. The entire `Map.tsx` component needs to be rewritten twice and wrapped behind an abstraction layer.

### App store deployment

Both require an Apple Developer account ($99/yr) and Xcode to produce an iOS binary. Both require Android Studio or Expo EAS to produce an Android binary. Capacitor gives you owned Xcode and Android Studio projects; Expo manages builds in the cloud. For a small project these are equivalent in effort.

### Community and documentation

React Native has a larger overall community (Meta backing, larger hiring pool). Capacitor's community is strong and focused: the Next.js + Capacitor pattern is well-documented with active guides. For a solo or small-team project, Capacitor's documentation is sufficient.

### Maintenance

Capacitor: web changes flow to mobile on the next `npm run build && npx cap sync`. No dual rendering path to maintain.

React Native: two rendering targets (native and web) with different libraries in each. RN upgrade cycles are historically disruptive.

---

## Decision: Capacitor, Option A2 (hosted URL)

**Capacitor is the right choice for Been There.**

The deciding factors:

1. The MapLibre map is the most complex part of the app. In Capacitor it runs unchanged in the WebView. In React Native, rewriting the map layer alone is a multi-week effort with no guarantee of full feature parity.
2. The web experience must remain intact. Capacitor achieves 100% code sharing with zero web-side changes.
3. The code delta is tiny. The Capacitor integration is additive — it adds a config file and a few dozen lines to `MapApp.tsx`. Nothing existing is removed or broken.
4. The background geolocation plugin (`@capacitor-community/background-geolocation`, MIT, free) solves the core problem cleanly.

**A2 specifically (pointing to the live Vercel URL)** is correct for this app because:

- The API routes (`/api/cells`, `/api/photos`) run server-side on Vercel and use cookie-based session auth with full RLS enforcement. The anon key alone cannot access anything. Moving to static export would require reimplementing auth and all data access on the client — more risk, more work.
- With A2, the Capacitor shell loads `https://been-there.vercel.app` in the WebView. Auth cookies, API routes, and SSR all work exactly as they do in a browser. Nothing server-side changes.
- Internet is required to use the app regardless (cells and photos sync to Supabase). Offline buffering for GPS-derived cells is added as a feature, not a requirement for the architecture.

**SSR**: No change. The Vercel deployment continues using Next.js App Router SSR. The native Capacitor app simply loads the Vercel URL in a WebView — it benefits from SSR without any configuration.

---

## What the implementation involves

See `plan.md` for phased delivery. At a high level:

1. Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`, and `@capacitor-community/background-geolocation` to the project.
2. Write `capacitor.config.ts` with `server.url` pointing to the Vercel deployment.
3. Generate iOS and Android native projects with `npx cap add ios` and `npx cap add android`.
4. Add background location permissions to `Info.plist` (iOS) and `AndroidManifest.xml` (Android).
5. In `MapApp.tsx`, wrap the existing GPS tracking path in a platform check: use the plugin on native, keep `navigator.geolocation` on web.
6. Add a small offline buffer (localStorage) so GPS-derived cells collected while offline are flushed to the server when connectivity returns.
7. Build the Android APK for sideloading; build the iOS app via the friend's Apple Developer account for distribution.
