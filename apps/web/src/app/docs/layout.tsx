import { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

// Developer docs: the console's fonts, without the console's form styles, so
// the embedded reference renders as designed.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <div className={`${geist.variable} ${geistMono.variable} min-h-screen bg-[#111114] text-[#ededf0]`}>{children}</div>;
}
