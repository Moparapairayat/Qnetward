"use client";

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const LENGTH = 6;

/**
 * Six boxes for an emailed code. Typing moves to the next box, Backspace to the
 * previous one, and pasting the whole code fills every box. onComplete fires
 * once all six digits are in.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // The latest code, ahead of the next render: fast typing and focus moves
  // happen before the parent's state comes back as the value prop.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  const focus = (i: number) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  // A rejected code is cleared; put the cursor back so the next try can start.
  useEffect(() => {
    if (invalid && !disabled && value === "") refs.current[0]?.focus();
  }, [invalid, disabled, value]);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, LENGTH);
    latest.current = clean;
    onChange(clean);
    if (clean.length === LENGTH) onComplete?.(clean);
    return clean;
  };

  const typeAt = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    // More than one digit means a paste or a phone autofilling the code.
    const now = latest.current;
    const clean = set(typed.length > 1 ? now.slice(0, i) + typed : now.slice(0, i) + typed + now.slice(i + 1));
    focus(Math.min(typed.length > 1 ? clean.length : i + 1, LENGTH - 1));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const now = latest.current;
      if (now[i]) {
        set(now.slice(0, i) + now.slice(i + 1));
      } else if (i > 0) {
        set(now.slice(0, i - 1) + now.slice(i));
        focus(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const clean = set(e.clipboardData.getData("text"));
    focus(Math.min(clean.length, LENGTH - 1));
  };

  return (
    <div className="grid grid-cols-6 gap-2" role="group" aria-label="Verification code">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={i === 0 ? "verify-code" : undefined}
          className={cn("auth-code-box", invalid && "auth-code-box-invalid")}
          value={digit}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          // Room for a pasted or autofilled code; typeAt keeps one digit per box.
          maxLength={LENGTH}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onFocus={(e) => {
            // Fill boxes in order: jump back to the first empty one.
            if (i > latest.current.length) focus(latest.current.length);
            else e.currentTarget.select();
          }}
          onChange={(e) => {
            // A box that kept its digit gets the new one typed beside it.
            const v = e.target.value;
            typeAt(i, digit && v.length === 2 ? v.replace(digit, "") : v);
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
        />
      ))}
    </div>
  );
}
