import type { CapacitorConfig } from '@capacitor/cli';

// Set CAPACITOR_ENV=production when building for distribution.
// In development, set CAPACITOR_DEV_URL to your machine's LAN IP and port,
// e.g. CAPACITOR_DEV_URL=http://192.168.1.X:3000 npx cap sync
const isProduction = process.env.CAPACITOR_ENV === 'production';
const devServerUrl = !isProduction ? process.env.CAPACITOR_DEV_URL : undefined;

const config: CapacitorConfig = {
  appId: 'com.beenthere.app',
  appName: 'Been There',
  // Required so background location + WebView bridge keep working after ~5 min backgrounded.
  // See https://github.com/capacitor-community/background-geolocation#android
  android: {
    useLegacyBridge: true,
  },
  // Production boots the bundled offline shell first. The shell redirects to the
  // hosted app when online and records locally when the phone cold-starts offline.
  webDir: 'out',
  server: {
    // Keep the hosted app inside the Capacitor WebView after the local offline
    // shell redirects; otherwise Android may hand the URL to the system browser.
    allowNavigation: ['been-there-maps.vercel.app'],
    ...(devServerUrl
      ? {
          url: devServerUrl,
          cleartext: true, // allow HTTP for local dev (Android); iOS needs NSAllowsLocalNetworking in Info.plist
        }
      : {}),
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
