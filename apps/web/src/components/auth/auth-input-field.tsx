"use client";

import { InputHTMLAttributes, KeyboardEvent, ReactNode, useState } from "react";
import { Eye, EyeOff, LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AuthInputFieldProps = {
  id: string;
  label: string;
  icon?: LucideIcon;
  error?: string;
  passwordToggle?: boolean;
  /** Rendered right-aligned under the field, e.g. a "Forgot password?" link. */
  labelAction?: ReactNode;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

const PLACEHOLDERS: Record<string, string> = {
  Email: "you@company.com",
  Password: "Your password",
  "New password": "At least 8 characters",
  "Confirm password": "Type it again",
  "First name": "Ada",
  "Last name": "Lovelace",
  "Verification code": "6-digit code",
  "Authentication code": "6-digit code",
  "Recovery code": "xxxxx-xxxxx",
};

/**
 * Auth field with its label above the input. `icon` is accepted for older
 * callers but no longer drawn: plain inputs read better on the split card.
 */
export function AuthInputField({ id, label, error, passwordToggle = false, labelAction, inputProps }: AuthInputFieldProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const { className, placeholder, type, onKeyUp, onBlur, ...restInputProps } = inputProps ?? {};
  const resolvedType = passwordToggle ? (showPassword ? "text" : "password") : type;
  const errorId = `${id}-error`;

  const handleKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (passwordToggle) setCapsLock(event.getModifierState("CapsLock"));
    onKeyUp?.(event);
  };

  return (
    <div className="auth-input-group">
      <label className="auth-field-label" htmlFor={id}>
        {label}
      </label>
      <div className={cn("auth-input-shell", error && "auth-input-shell-error")}>
        <Input
          id={id}
          className={cn("auth-input", passwordToggle && "pr-11", className)}
          placeholder={placeholder ?? PLACEHOLDERS[label] ?? label}
          type={resolvedType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onKeyUp={handleKeyUp}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
          {...restInputProps}
        />
        {passwordToggle ? (
          <button
            type="button"
            className="auth-password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="auth-field-error">
          {error}
        </p>
      ) : capsLock ? (
        <p className="auth-field-hint">Caps Lock is on</p>
      ) : null}
      {labelAction ? <div className="flex">{labelAction}</div> : null}
    </div>
  );
}
