import { Check } from "@/components/icons";
import { evaluatePasswordStrength } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

type PasswordStrengthMeterProps = {
  password: string;
  /** Kept for compatibility; the meter is always compact now. */
  compact?: boolean;
};

/**
 * Strength bar and a checklist of the rules, shown only once the person starts
 * typing so an empty form stays short.
 */
export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) return null;
  const strength = evaluatePasswordStrength(password);
  const activeBars = Math.max(strength.score, 1);

  return (
    <div className="grid gap-2" aria-live="polite">
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
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {strength.rules.map((rule) => (
          <li key={rule.id} className={cn("flex items-center gap-1 text-[12px]", rule.met ? "text-[#86efac]" : "text-[var(--lp-subtle)]")}>
            <Check className={cn("h-3 w-3", rule.met ? "opacity-100" : "opacity-30")} aria-hidden="true" />
            {rule.label}
            <span className="sr-only">{rule.met ? "(done)" : "(missing)"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
