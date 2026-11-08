import { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AuthArt } from "@/components/auth/auth-art";
import { QnetwardMark } from "@/features/landing/qnetward-mark";

type HeaderAction = { prompt: string; label: string; href: string };

/**
 * Split auth card: the form on the left, artwork on the right (hidden on small
 * screens). The logo heads the form, the other path (sign in / sign up) sits
 * under it, and the terms line sits under the card.
 */
export function AuthLayoutCard({
  title,
  subtitle,
  headerAction,
  contentClassName,
  below,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** Kept for compatibility; the split card has no icon badge. */
  icon?: ReactNode;
  /** Kept for compatibility; no longer rendered. */
  eyebrow?: string;
  headerAction?: HeaderAction;
  /** Kept for compatibility; every auth page now uses the same card size. */
  wide?: boolean;
  contentClassName?: string;
  /** Shown under the card, above the terms line (e.g. the demo entry). */
  below?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center bg-[#18181b] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] sm:justify-center sm:px-4 sm:py-12 sm:short:py-2">
      {/* On phones the card is the page: no frame, full width. From sm up it floats as a card. */}
      <div
        className={cn(
          // One size for every auth page, so moving between sign in, sign up, and its steps doesn't make the card jump.
          "grid w-full max-w-[480px] overflow-hidden sm:rounded-2xl sm:border sm:border-[var(--lp-border)] sm:bg-[#1d1d21] sm:shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:min-h-[620px] lg:short:min-h-0 lg:max-w-[920px] lg:grid-cols-2",
        )}
      >
        <div className="flex flex-col px-5 py-7 sm:px-10 sm:py-9 sm:short:py-6">
          <Link
            href="/"
            className="mb-7 flex w-fit items-center gap-2.5 sm:mb-7 sm:short:mb-4"
            aria-label="Qnetward home"
          >
            <QnetwardMark size={30} />
            <span className="text-[18px] font-semibold tracking-[-0.01em]">
              Qnetward
            </span>
          </Link>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] sm:text-[24px]">
            {title}
          </h1>
          <div className="mt-1.5 text-[14px] leading-relaxed text-[var(--lp-muted)]">
            {subtitle}
          </div>
          <div className={cn("mt-6 flex-1 sm:short:mt-3", contentClassName)}>
            {children}
          </div>
          {headerAction ? (
            <p className="mt-6 text-center text-[14px] text-[var(--lp-muted)] sm:short:mt-3">
              {headerAction.prompt}{" "}
              <Link href={headerAction.href} className="auth-footer-link">
                {headerAction.label}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="relative hidden min-h-[520px] lg:block lg:short:min-h-0">
          <AuthArt />
        </div>
      </div>

      {/* On short screens the demo entry and the terms share one row. */}
      <div className="flex flex-col items-center sm:short:mt-3 sm:short:flex-row sm:short:gap-5">
        {below ? (
          <div className="mt-2 sm:mt-6 sm:short:mt-0">{below}</div>
        ) : null}
        <p className="mt-5 max-w-[340px] px-5 text-center text-[12px] leading-relaxed text-[var(--lp-subtle)] sm:mt-6 sm:max-w-none sm:short:mt-0 sm:short:px-0">
          By continuing, you agree to our{" "}
          <Link
            href="/terms"
            className="auth-footer-link text-[var(--lp-muted)]"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="auth-footer-link text-[var(--lp-muted)]"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
