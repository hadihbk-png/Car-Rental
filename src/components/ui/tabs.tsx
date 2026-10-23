"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Accessible name for the tab list. */
  label: string;
  defaultTab?: string;
  /** Controlled mode. */
  value?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}

/** WAI-ARIA tabs with roving tabindex: Left/Right/Home/End move and activate. */
export function Tabs({ items, label, defaultTab, value, onValueChange, className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultTab ?? items.find((i) => !i.disabled)?.id);
  const active = value ?? internal;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.findIndex((i) => i.id === active);
    let next: TabItem | undefined;
    if (e.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-line">
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              className={cn(
                "-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                selected ? "border-brand-700 text-brand-800" : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="pt-4 focus-visible:outline-offset-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

export interface LinkTabItem {
  href: string;
  label: ReactNode;
  /** Marks the current page. */
  current?: boolean;
  count?: number;
}

/** Navigation styled as tabs (each tab is a page/URL). Uses aria-current, not role="tab". */
export function LinkTabs({ items, label, className }: { items: readonly LinkTabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("border-b border-line", className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                item.current ? "border-brand-700 text-brand-800" : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-muted tabular">{item.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
