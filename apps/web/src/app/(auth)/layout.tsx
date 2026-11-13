import "@/features/landing/landing.css";
import "@/features/auth/auth.css";
import { RememberNext } from "@/components/auth/remember-next";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="lp-root lp-auth">
      <RememberNext />
      {children}
    </div>
  );
}
