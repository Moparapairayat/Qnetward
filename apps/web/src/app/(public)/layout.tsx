import { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "@/features/landing/landing.css";
import "@/features/console/console.css";

// Public pages anyone can open, such as status pages: the console's look,
// without the sign-in guard.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className={`lp-root lp-console min-h-screen ${geist.variable} ${geistMono.variable}`}>{children}</div>;
}
