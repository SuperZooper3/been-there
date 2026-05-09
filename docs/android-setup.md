# Android App Setup Guide

This guide takes you from zero to a sideloaded APK on your Android phone. No Google Play account needed. Read the whole thing once before starting — there are a few places where you make a choice that affects later steps.

**This guide assumes macOS** (Apple Silicon or Intel). Android Studio, Terminal, and `adb` paths match a Mac. If you use Windows or Linux, the flow is the same but menu labels and JDK locations may differ slightly.

**Time estimate**: 30–60 minutes on first run (mostly waiting on Gradle), 5–10 minutes for subsequent builds.

**Prerequisites before you start**:
- The web app is deployed to Vercel and working at [https://been-there-maps.vercel.app/](https://been-there-maps.vercel.app/)
- You have run `npm install` and `npx cap sync` in the project at least once (the `android/` folder already exists after Capacitor setup)
- A Mac with enough disk space for Android Studio and the Android SDK (~10 GB)

---

## Step 1 — Install Android Studio

Download **Android Studio for Mac** from [developer.android.com/studio](https://developer.android.com/studio) (the site detects macOS). Open the `.dmg`, drag **Android Studio** into **Applications**, and launch it. Install with the default options. This gives you:

- The Android SDK
- A bundled JDK (Java 17 — the version Gradle requires)
- An Android emulator (useful for quick testing)
- The `adb` command-line tool for installing APKs

After installing, open Android Studio once and let it finish downloading the SDK components it prompts for. Click through the setup wizard with defaults.

---

## Step 2 — Open the Android project in Android Studio

In **Terminal**, `cd` to the project root (where `package.json` lives), then:

```bash
npx cap open android
```

This opens the `android/` folder directly in Android Studio. Wait for the **Gradle sync** to complete — the first sync downloads dependencies and takes 3–10 minutes depending on your connection. You will see progress in the bottom status bar. Do not interrupt it.

If Android Studio asks to upgrade the Gradle plugin version, click **Don't remind me again** — the version in the project is correct.

---

## Step 3 — Verify the project looks right

Once Gradle sync finishes:

1. In the **Project** panel (left sidebar), expand `app > manifests` and open `AndroidManifest.xml`. Confirm you can see these permissions near the bottom:
   - `ACCESS_FINE_LOCATION`
   - `ACCESS_BACKGROUND_LOCATION`
   - `FOREGROUND_SERVICE_LOCATION`

2. Expand `app > java > com.beenthere.app` and confirm `MainActivity` exists.

3. In the top toolbar, make sure the device/emulator selector shows either a connected device or an emulator. If nothing is there, see Step 4 (connecting a device) or Step 5 (using the emulator).

---

## Step 4 — Connect your Android device for testing (recommended)

Testing on a real device is far better than an emulator for GPS and background features.

### Enable developer mode on your phone

1. Go to **Settings → About phone**.
2. Tap **Build number** seven times. You will see "You are now a developer".
3. Go back to **Settings → Developer options**.
4. Enable **USB debugging**.

### Connect and authorize

1. Plug your phone into your Mac with a **data-capable** USB cable (some cables are charge-only).
2. On the phone, a dialog appears: "Allow USB debugging from this computer?" — tap **Allow** and check "Always allow from this computer".
3. In Android Studio's device selector (top toolbar), your phone should appear by name within a few seconds.

### Verify ADB sees the device

`adb` is installed with Android Studio but not always on your shell `PATH`. Either open the **Terminal** tool window at the bottom of Android Studio (**View → Tool Windows → Terminal**) or use the full path (typical on a Mac):

```bash
~/Library/Android/sdk/platform-tools/adb devices
```

If you prefer `adb` without the path, add this to `~/.zshrc` (then run `source ~/.zshrc`):

```bash
export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
```

You should see your device listed as `device` (not `unauthorized`). If it shows `unauthorized`, re-check the USB debugging authorization on the phone.

---

## Step 5 — (Alternative) Use the Android Emulator

If you don't want to use a physical device yet:

1. In Android Studio, go to **Tools → Device Manager**.
2. Click **Create Device**.
3. Choose **Pixel 9** (or any recent Pixel model) and click **Next**.
4. Download and select a **system image** with API 35 or 36 (click the download arrow next to it). Click **Next → Finish**.
5. Launch the emulator from Device Manager by clicking the play button.

**Note**: Background GPS tracking does not work in the emulator. Use it for UI verification only. Always test actual background tracking on a real device.

---

## Step 6 — Run a debug build on the device

With your device or emulator selected in the toolbar, click the green **Run** button (▶), or press **Control-R** (default macOS shortcut in Android Studio).

Android Studio will:
1. Compile the app
2. Install it on your device
3. Launch it automatically

The app will open and load [https://been-there-maps.vercel.app/](https://been-there-maps.vercel.app/) in a WebView. Sign in with your credentials. The map should load and everything should work exactly as in the browser.

**If the map shows blank grey tiles**: Stadia Maps tile authentication is failing from the WebView. This means the `Referer` header isn't being sent correctly. See the troubleshooting section at the end of this document.

---

## Step 7 — Test background tracking before building a release APK

Before creating the release build, verify the core native feature works:

1. Open the app on your device via the debug build.
2. Sign in and reach the map. The first time, an **onboarding** sheet explains notifications and battery limits — read it, then dismiss with **Got it**.
3. Tap the **Track** button in the top-left panel.
4. **Location**: your phone will ask for location — tap **Allow all the time** if you want cells to paint while the screen is locked (**While using the app** only works when Been There is open).
5. **Notifications (Android 13+)**: a second system prompt may ask you to allow notifications. Tap **Allow** — without this, the ongoing tracking alert may not appear in the shade (the app still uses a foreground service, but the OS can hide the visible notification).
6. Pull down the notification shade. You should see **Been There** with a short line like **Recording your path** (silent, low priority — it does not re-alert on every GPS ping). That confirms the foreground service is running.
7. Walk around, lock your phone and put it in your pocket for 2–3 minutes.
8. Unlock and open the app. New cells should have been painted while the screen was locked.

The stats panel also shows **Last GPS: …** while tracking on Android, so you can confirm fixes without opening the shade.

**Important — Android battery optimization**: On Samsung, Xiaomi, Huawei, and OnePlus devices, an aggressive battery optimizer may kill the background service even with the foreground service notification. If tracking stops after a minute or two of being backgrounded:

- Go to **Settings → Apps → Been There → Battery**.
- Set it to **Unrestricted** (or "No restrictions" depending on Android version).

Standard Android (Google Pixel, Android One) does not have this problem.

**If you still never see the tracking notification** after allowing notifications: uninstall Been There once, reinstall the debug APK, and try again — Android caches notification channel settings per install; a clean install picks up the current channel used for tracking.

---

## Step 8 — Create a release keystore (do this once, keep it forever)

The release keystore is what cryptographically signs your APK. **If you lose it, you can never update the app on any device that has already installed it** (they will reject the new APK). Keep this file safe.

In Android Studio:

1. Go to **Build → Generate Signed Bundle / APK**.
2. Select **APK** (not Android App Bundle — AAB is for Google Play; you need APK for sideloading).
3. Click **Next**.
4. Click **Create new...** next to the Key store path field.
5. Fill in the form:
   - **Key store path**: choose a location outside the project folder (e.g. `~/Documents/been-there-release.jks`)
   - **Password**: choose a strong password — write it down somewhere safe
   - **Key alias**: `been-there`
   - **Key password**: can be the same as store password
   - **Validity**: 25 years (the default is fine)
   - **First and Last Name**: your name (this is just metadata on the cert)
6. Click **OK** to create the keystore.
7. Back in the wizard, the keystore path and passwords are now filled in. Click **Next**.

**Back up the keystore file** somewhere that isn't just your laptop — cloud storage, a password manager, an external drive. Treat it like a password.

---

## Step 9 — Build the release APK

Continuing from Step 8 (or restart from **Build → Generate Signed Bundle / APK** and load your existing keystore):

1. Select **release** as the build variant.
2. Choose a destination folder for the APK (e.g. `~/Desktop`).
3. Make sure **V1 (Jar Signature)** and **V2 (Full APK Signature)** are both checked.
4. Click **Finish**.

Gradle compiles and signs the APK. Progress appears in the bottom status bar. This takes 2–5 minutes on first build, faster after (Gradle caches most of the compilation).

When done, a notification appears: "APK(s) generated successfully". Click **Locate** to open the folder containing `app-release.apk`.

---

## Step 10 — Install the APK on a device

### Via ADB (fastest, for your own device)

```bash
adb install -r ~/Desktop/app-release.apk
```

`-r` means "reinstall" — it replaces any existing version without wiping data. On first install, omit it:

```bash
adb install ~/Desktop/app-release.apk
```

The app installs and appears on the home screen.

### Via direct file transfer (to share with someone else)

1. From your Mac, get the `.apk` onto the Android device: **Google Drive**, **Dropbox**, **email to yourself**, **Telegram**, or copy via **USB** (Android File Transfer or the phone’s USB file mode). AirDrop does not target Android phones directly.
2. On the Android device, open the file. If "Install unknown apps" is blocked, the system will show a prompt.
3. Go to **Settings → Apps → [the app you used to open the file, e.g. Files or Chrome] → Install unknown apps** and enable it.
4. Go back and tap the APK file again. Tap **Install**.

---

## Step 11 — Verify the installed release APK

Open the installed Been There app. Walk through the same checklist as Step 7:

- Sign in works
- Map loads with tiles
- Track button starts GPS with a status bar notification
- Background tracking paints cells while locked

If sign-in works in the debug build but not the release build, the issue is usually a Supabase **Authentication → URL Configuration** mismatch: **Site URL** and **Redirect URLs** must include your live app origin, e.g. `https://been-there-maps.vercel.app` (and the wildcard `https://been-there-maps.vercel.app/**` for redirects).

---

## Development vs. production builds

The `capacitor.config.ts` in this project has two modes:

| Mode | `server.url` | How to activate |
|------|-------------|-----------------|
| Development | Your Mac's LAN IP (e.g. `http://192.168.1.X:3000`) | No env var (default) |
| Production | `https://been-there-maps.vercel.app` | `CAPACITOR_ENV=production` |

For local development with a real device (so you can see code changes without deploying to Vercel):

1. Find your Mac's LAN IP (Wi‑Fi is usually `en0`; Ethernet is often `en1`):
   ```bash
   ipconfig getifaddr en0
   ```
   If that prints nothing, try:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
2. Edit `capacitor.config.ts` and set the dev URL, or set the env var:
   ```bash
   CAPACITOR_DEV_URL=http://192.168.1.X:3000 npx cap sync
   ```
3. Run `npm run dev` on your machine (Next.js listens on all interfaces by default).
4. Run the debug build on your device — it will load from your local Next.js server.

**Your phone and your computer must be on the same Wi-Fi network.** `localhost` will not work — the phone would try to reach itself.

**Switch back to production before building the release APK**:
```bash
CAPACITOR_ENV=production npx cap sync
# then build the APK in Android Studio
```

---

## Per-update workflow

Because the app content loads from Vercel (A2 architecture), **most code changes don't need a new APK**:

```
Change code → git push → Vercel auto-deploys → app updates on next launch
```

You only need to rebuild the APK when you change something native:

| Change type | Need new APK? |
|-------------|--------------|
| UI, map logic, tracking code | No — deploy to Vercel |
| `capacitor.config.ts` | Yes |
| Adding/updating a Capacitor plugin | Yes — `npx cap sync` then rebuild |
| `AndroidManifest.xml` permissions | Yes |
| App icon or splash screen | Yes |

When you do need a new APK:

```bash
CAPACITOR_ENV=production npx cap sync
# then: Android Studio → Build → Generate Signed Bundle/APK → use existing keystore → Finish
```

---

## Troubleshooting

### Gradle sync fails on first open
- Make sure Android Studio finished its initial SDK setup before opening the project.
- Try **File → Sync Project with Gradle Files**.
- If it mentions a JDK issue, go to **File → Project Structure → SDK Location** and confirm the JDK is set to Android Studio's bundled JDK.

### App opens but shows a white/blank screen
- The WebView can't reach `been-there-maps.vercel.app`. Check your internet connection.
- In dev mode: make sure `npm run dev` is running on your machine and the LAN IP in `capacitor.config.ts` is correct.

### Map tiles are blank grey squares
- Stadia Maps domain authentication is failing. The WebView may not be sending the correct `Referer` header.
- Confirm **Stadia Maps → Manage Properties → Authentication** includes your production host: `been-there-maps.vercel.app` (same as in [`docs/manual-setup.md`](./manual-setup.md) for the web app).
- **Fix**: Get a Stadia API key from [stadiamaps.com](https://client.stadiamaps.com/dashboard/) and add it to the tile URL in `Map.tsx`. Store it as `NEXT_PUBLIC_STADIA_API_KEY` in your Vercel env vars and `.env.local`.

### Background tracking stops after a few minutes
- OEM battery optimization (Samsung, Xiaomi, Huawei). See Step 7 — set battery to **Unrestricted** for the app.
- Confirm the tracking notification appears in the **notification shade** while tracking (it may not show a persistent icon in the status bar — that is normal for a low-noise channel). If nothing appears in the shade at all, check notification permission and try a reinstall as in Step 7.

### "App not installed" when sideloading
- The APK was signed with a different keystore than the version already installed. Uninstall the existing app first, then install the new APK. (All local data will be cleared, but everything is synced to Supabase so nothing is lost.)

### `adb devices` shows `unauthorized`
- Unplug and replug the USB cable.
- On the phone, dismiss and re-accept the "Allow USB debugging" dialog.
- Try a different USB cable (many cables are charge-only).
