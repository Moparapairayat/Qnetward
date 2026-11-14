import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { AppProviders } from "@/providers/app-providers";
import "./globals.css";

// Geist for text and Geist Mono for code and figures across the site, console,
// and docs. Inter is used only by the landing hero. Loaded once, here.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://qnetward.moparapairayat.one"),
  title: {
    default: "Qnetward — Real-Time Network Monitoring",
    template: "%s | Qnetward",
  },
  description:
    "Monitor your network in real time with live ping, TCP checks, port scans, DNS inspection, alerts, and searchable history. Self-hosted and built for teams.",
  applicationName: "Qnetward",
  openGraph: {
    type: "website",
    url: "https://qnetward.moparapairayat.one/",
    siteName: "Qnetward",
    title: "Qnetward — Real-Time Network Monitoring",
    description:
      "Live network diagnostics, latency insights, and monitoring in one self-hosted workspace.",
    images: [
      {
        url: "/brand/qnetward-social-preview.jpg",
        width: 1482,
        height: 690,
        alt: "Qnetward real-time network monitoring dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Qnetward — Real-Time Network Monitoring",
    description:
      "Live network diagnostics, latency insights, and monitoring in one self-hosted workspace.",
    images: ["/brand/qnetward-social-preview.jpg"],
  },
  icons: {
    icon: [{ url: "/brand/qnetward-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/qnetward-mark.svg",
    apple: "/brand/qnetward-mark.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${inter.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
