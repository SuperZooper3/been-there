import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://beenthere.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Been There",
  description: "Fill out the map by visiting places.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Been There",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [{ url: "/apple-touch-icon.png" }],
    other: [
      { rel: "icon", url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Been There",
    description: "Fill out the map by visiting places.",
    siteName: "Been There",
    images: [
      {
        url: "/been-there-long.png",
        alt: "Been There",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Been There",
    description: "Fill out the map by visiting places.",
    images: ["/been-there-long.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f5f0e8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}
