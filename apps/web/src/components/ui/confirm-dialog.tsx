"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";

/**
 * Asks before something that can't be undone. Renders its trigger and opens a
 * dialog in the console's style, replacing the browser's own confirm box.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  busy,
  trigger,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The dialog focuses its first control (the close button) when it opens;
  // move focus to Cancel, the safe choice, so Enter never deletes by accident.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        className="max-w-[440px]"
        footer={
          <>
            <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={() => setOpen(false)} ref={cancelRef}>
              Cancel
            </button>
            <button
              type="button"
              className="console-btn h-9 bg-[#e5336f] px-4 font-medium text-white hover:bg-[#ff3d7f] disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--lp-muted)]">{message}</p>
      </Modal>
    </>
  );
}
