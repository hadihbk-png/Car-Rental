"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "./icons";

export type ToastTone = "info" | "success" | "error";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss; errors stay until dismissed when 0. Default 5000 (errors 8000). */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, "description">> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Shows short-lived notifications. Must be rendered inside <ToastProvider> (in the root layout). */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const toneStyle: Record<ToastTone, { Icon: typeof InfoIcon; icon: string }> = {
  info: { Icon: InfoIcon, icon: "text-sky-300" },
  success: { Icon: CheckCircleIcon, icon: "text-emerald-300" },
  error: { Icon: AlertCircleIcon, icon: "text-red-300" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const tone = input.tone ?? "info";
      const duration = input.duration ?? (tone === "error" ? 8000 : 5000);
      setItems((list) => [...list.slice(-3), { id, title: input.title, description: input.description, tone, duration }]);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Polite live region; always mounted so announcements are not missed. */}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {items.map((t) => {
          const { Icon, icon } = toneStyle[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl bg-brand-950 p-4 text-sm text-white shadow-overlay"
            >
              <Icon className={cn("mt-0.5 shrink-0", icon)} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}</p>
                {t.description && <p className="mt-0.5 text-brand-100">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-brand-100 hover:bg-white/10 hover:text-white focus-visible:outline-white"
                aria-label="Dismiss notification"
              >
                <CloseIcon size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
