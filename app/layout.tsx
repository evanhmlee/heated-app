import type { Metadata, Viewport } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "./providers";
import PackOffer from "@/components/pack-offer";

// Geist carries body, UI, and numerals; Geist Mono is reserved for data
// labels and small caps. Archivo (variable width axis, used at its expanded
// extreme via .font-athletic) is the display face for giant poster headlines
// only. This replaces the retired Anton: the athletic read now comes from
// width + weight at massive scale, not from a condensed novelty face.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

// metadataBase makes the opengraph-image URL absolute in unfurls. Production
// is www.getheated.app (apex 308s to www); keep in sync with the
// originFromHeaders fallback in app/v/[id]/page.tsx.
export const metadata: Metadata = {
  metadataBase: new URL("https://www.getheated.app"),
  title: "Heated: Every Argument, Settled.",
  description:
    "The basketball debate app with an AI judge. Debate the AI or a human, get a scored verdict backed by real NBA stats, climb the leaderboard.",
  openGraph: {
    title: "Heated: Every Argument, Settled.",
    description:
      "AI-judged basketball debates. Argue your take, get a scored verdict backed by real NBA stats, settle it for good.",
    siteName: "Heated",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Heated: Every Argument, Settled.",
    description:
      "AI-judged basketball debates. Argue your take, get a scored verdict backed by real NBA stats, settle it for good.",
  },
};

export const viewport: Viewport = {
  themeColor: "#070811",
  // Without this iOS never reports non-zero safe-area insets, so every
  // env(safe-area-inset-*) in the app resolves to 0. Six surfaces already
  // depend on them (the bottom tab bar, the hub and new-debate page gutters,
  // the new-debate action bar, the leaderboard's pinned rank row), each with a
  // comment reasoning about the home indicator, and not one of them had ever
  // had any effect. Changing this MOVES all six, so re-check them on a notched
  // device rather than assuming it is a no-op.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PostHogProvider>
          {children}
          {/* Inert until a surface announces an empty wallet, so the landing
              page pays for a listener and nothing else. */}
          <PackOffer />
        </PostHogProvider>
      </body>
    </html>
  );
}
