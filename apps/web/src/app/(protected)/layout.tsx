import { ReactNode } from "react";
import { AuthGuard } from "@/components/app/auth-guard";
import "@/features/landing/landing.css";
import "@/features/console/console.css";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lp-root lp-console">
      <AuthGuard>{children}</AuthGuard>
    </div>
  );
}
