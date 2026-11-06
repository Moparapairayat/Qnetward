import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Numbered progress across the top of a multi-step dialog. */
export function Stepper({ steps, step }: { steps: readonly string[]; step: number }) {
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Steps">
      {steps.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px]",
                done
                  ? "border-[rgba(74,222,128,0.45)] bg-[rgba(74,222,128,0.12)] text-[#86efac]"
                  : current
                    ? "border-[rgba(255,61,127,0.55)] bg-[rgba(255,61,127,0.12)] text-[#ff8fb3]"
                    : "border-[var(--lp-border-strong)] text-[var(--lp-subtle)]",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn("hidden truncate text-[12px] sm:block", current ? "text-[var(--lp-text)]" : "text-[var(--lp-subtle)]")}>{label}</span>
            {i < steps.length - 1 ? <span className="h-px min-w-3 flex-1 bg-[var(--lp-border-strong)]" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
