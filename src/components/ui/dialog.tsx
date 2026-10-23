"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { CloseIcon } from "./icons";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, rendered in a sticky footer. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** "sheet" slides up from the bottom on small screens (used for the filter drawer). */
  variant?: "center" | "sheet";
  /** Prevent closing via backdrop click (e.g. while a request is running). Escape still works unless `dismissible` is false. */
  dismissible?: boolean;
  className?: string;
}

const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };

/**
 * Modal dialog on the native <dialog> element: focus is trapped and restored by the browser,
 * Escape closes, the backdrop is inert. Controlled by `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  variant = "center",
  dismissible = true,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-transparent open:flex",
        "fixed inset-0 h-full w-full justify-center",
        variant === "center" ? "items-center p-4" : "items-end sm:items-center sm:p-4",
      )}
    >
      <div
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden bg-surface shadow-overlay",
          variant === "sheet"
            ? "max-h-[90dvh] animate-sheet-in rounded-t-2xl sm:max-h-[calc(100dvh-2rem)] sm:animate-none sm:rounded-2xl"
            : "rounded-2xl",
          widths[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          )}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/60 px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}
