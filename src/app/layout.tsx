import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://wasmo.site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Wasmo — Video Platform",
    template: "%s · Wasmo",
  },
  description:
    "Wasmo is a modern video platform with adaptive streaming, categorized browsing, full-text search and crawlable transcripts optimized for search and answer engines.",
  keywords: ["wasmo", "video", "streaming", "HLS", "video platform"],
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
  },
  alternates: {
    canonical: "/",
    languages: {
      en: "/",
      so: "/",
      "x-default": "/",
    },
  },
  // Adult-content compliance signals (industry standard RTA labelling)
  other: {
    rating: "adult",
    "RTA-5042-1996-1400-1577-RTA": "",
  },
  openGraph: {
    type: "website",
    siteName: "Wasmo",
    url: SITE_URL,
    title: "Wasmo — Video Platform",
    description:
      "Adaptive streaming, crawlable transcripts and edge-cached delivery — a video platform built for search and answer engines.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wasmo — Video Platform",
    description:
      "Adaptive streaming, crawlable transcripts and edge-cached delivery.",
  },
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
