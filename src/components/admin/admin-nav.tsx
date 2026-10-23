"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import {
  AlertTriangleIcon,
  BuildingIcon,
  CarIcon,
  ClipboardIcon,
  KeyIcon,
  LayoutIcon,
  ReturnIcon,
  TagIcon,
} from "@/components/ui/icons";

export interface AdminNavItem {
  id: string;
  href: string;
  label: string;
  icon: ReactNode;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { id: "overview", href: "/admin", label: "Overview", icon: <LayoutIcon size={18} /> },
  { id: "reservations", href: "/admin/reservations", label: "Reservations", icon: <ClipboardIcon size={18} /> },
  { id: "checkout", href: "/admin/check-out", label: "Check-out", icon: <KeyIcon size={18} /> },
  { id: "checkin", href: "/admin/check-in", label: "Check-in", icon: <ReturnIcon size={18} /> },
  { id: "fleet", href: "/admin/fleet", label: "Fleet", icon: <CarIcon size={18} /> },
  { id: "branches", href: "/admin/branches", label: "Branches", icon: <BuildingIcon size={18} /> },
  { id: "pricing", href: "/admin/pricing", label: "Pricing & extras", icon: <TagIcon size={18} /> },
  { id: "damage", href: "/admin/damage", label: "Damage reports", icon: <AlertTriangleIcon size={18} /> },
];

function activeId(pathname: string | null): string {
  if (!pathname) return "";
  const match = [...ADMIN_NAV]
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.id ?? "";
}

export function AdminNav({ counts = {} }: { counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  const current = activeId(pathname);
  return (
    <nav aria-label="Admin">
      <p className="mb-3 hidden px-3 text-xs font-bold tracking-widest text-ink-subtle uppercase lg:block">Administration</p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:border-0 lg:px-0">
        {ADMIN_NAV.map((item) => {
          const active = item.id === current;
          const count = counts[item.id];
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
                  // mobile: tab style; desktop: sidebar pill
                  "-mb-px border-b-2 px-3 lg:mb-0 lg:rounded-lg lg:border-b-0",
                  active
                    ? "border-brand-700 text-brand-800 lg:bg-brand-50"
                    : "border-transparent text-ink-muted hover:text-ink lg:hover:bg-surface-muted",
                )}
              >
                <span className={cn("hidden lg:inline", active ? "text-brand-700" : "text-ink-subtle")} aria-hidden="true">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {count !== undefined && count > 0 && (
                  <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-bold text-accent-800 tabular">
                    {count}
                    <span className="sr-only"> pending</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
