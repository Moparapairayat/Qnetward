import { evaluatePasswordStrength } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

type PasswordStrengthMeterProps = {
  password: string;
  /** Kept for compatibility; the meter is always compact now. */
  compact?: boolean;
};

/**
 * Strength bar and what the password still lacks, shown only once the person
 * starts typing so an empty form stays short.
 */
export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) return null;
  const strength = evaluatePasswordStrength(password);
  const activeBars = Math.max(strength.score, 1);
  // Only what's left to do, in one line, so the form stays short.
  const missing = strength.rules.filter((rule) => !rule.met);

  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <span
              key={index}
              className={cn("h-1 rounded-full bg-white/[0.08] transition-all duration-200", index < activeBars && `bg-gradient-to-r ${strength.meterClassName}`)}
            />
          ))}
        </div>
        <span className={cn("shrink-0 text-[12px] font-medium", strength.accentClassName)}>{strength.label}</span>
      </div>
      {missing.length ? (
        <p className="text-[12px] text-[var(--lp-subtle)]">
          Add {missing.map((rule) => rule.label.charAt(0).toLowerCase() + rule.label.slice(1)).join(", ").replace(/, ([^,]*)$/, " and $1")}.
        </p>
      ) : null}
    </div>
  );
}
