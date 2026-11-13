import "@/features/landing/landing.css";
import "@/features/auth/auth.css";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="lp-root lp-auth">{children}</div>;
}
