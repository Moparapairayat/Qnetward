import { ReactNode } from "react";
import "@/features/landing/landing.css";
import "@/features/console/console.css";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="lp-root lp-console min-h-screen">{children}</div>;
}
