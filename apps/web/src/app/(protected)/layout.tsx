import { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthGuard } from "@/components/app/auth-guard";
import "@/features/landing/landing.css";
import "@/features/console/console.css";

// The console uses Geist, a typeface drawn for interfaces: it stays crisp at
// the 13–14px sizes most of the console is set in.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`lp-root lp-console ${geist.variable} ${geistMono.variable}`}>
      <AuthGuard>{children}</AuthGuard>
    </div>
  );
}
