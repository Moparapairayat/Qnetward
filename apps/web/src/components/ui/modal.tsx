"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * A modal built on the native <dialog> element, which handles focus trapping,
 * Escape, and the inert backdrop. `dismissible` false keeps it open on Escape
 * and backdrop clicks, for steps where closing would lose something.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      className={cn(
        "lp-modal m-auto w-[calc(100%-2rem)] max-w-[560px] rounded-xl border border-[var(--lp-border-strong)] bg-[#0a0a0a] p-0 text-[var(--lp-text)] shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        className,
      )}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--lp-border)] px-5 py-4">
            <div className="min-w-0">
              <h2 id="modal-title" className="text-md font-medium">
                {title}
              </h2>
              {description ? <div className="mt-1 text-sm leading-relaxed text-[var(--lp-muted)]">{description}</div> : null}
            </div>
            {dismissible ? (
              <button type="button" aria-label="Close" className="console-btn h-8 w-8 shrink-0 px-0 text-[var(--lp-muted)] hover:bg-white/[0.05]" onClick={onClose}>
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--lp-border)] bg-white/[0.015] px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
