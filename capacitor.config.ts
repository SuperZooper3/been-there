import type { CapacitorConfig } from '@capacitor/cli';

// Set CAPACITOR_ENV=production when building for distribution.
// In development, set CAPACITOR_DEV_URL to your machine's LAN IP and port,
// e.g. CAPACITOR_DEV_URL=http://192.168.1.X:3000 npx cap sync
const isProduction = process.env.CAPACITOR_ENV === 'production';

const config: CapacitorConfig = {
  appId: 'com.beenthere.app',
  appName: 'Been There',
  // Required so background location + WebView bridge keep working after ~5 min backgrounded.
  // See https://github.com/capacitor-community/background-geolocation#android
  android: {
    useLegacyBridge: true,
  },
  // out/ is a placeholder dir required by Capacitor CLI.
  // In A2 mode (server.url set) the native app loads from Vercel, not this dir.
  webDir: 'out',
  server: {
    url: isProduction
      ? 'https://been-there-maps.vercel.app'
      : (process.env.CAPACITOR_DEV_URL ?? 'http://YOUR_LAN_IP:3000'),
    cleartext: !isProduction, // allow HTTP for local dev (Android); iOS needs NSAllowsLocalNetworking in Info.plist
  },
  plugins: {
    // Key name verified against @capacitor-community/background-geolocation README.
    // If Android shows a blank notification title, this key name may need adjusting.
    BackgroundGeolocation: {
      notificationTitle: 'Been There',
      notificationText: 'Recording your path',
    },
  },
};

export default config;
