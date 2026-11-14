import { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[#ededed] text-[#0a0a0a] hover:bg-white",
  secondary: "border border-white/[0.14] bg-white/[0.03] text-[#ededf0] hover:bg-white/[0.07]",
  ghost: "bg-transparent text-[#ededf0] hover:bg-white/[0.06]",
  danger: "border border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.14)]",
};

export function Button({ className, variant = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
