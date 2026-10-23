"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import type { Actor } from "@/lib/auth/types";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/ui/cn";
import { ROUTES } from "@/lib/ui/routes";
import { buttonClasses } from "@/components/ui/button";
import { CloseIcon, LogOutIcon, MenuIcon, ShieldIcon, UserIcon } from "@/components/ui/icons";
import { Logo } from "./logo";

export type HeaderUser = Pick<Actor, "name" | "email" | "role">;

export interface SiteHeaderProps {
  /** Signed-in user, or null when signed out. */
  user: HeaderUser | null;
  /** Session still loading (Suspense fallback): renders the same layout with a placeholder account slot. */
  pending?: boolean;
}

interface NavItem {
  href: string;
  label: string;
}

function navItems(user: HeaderUser | null): NavItem[] {
  const items: NavItem[] = [
    { href: ROUTES.search, label: "Search cars" },
    { href: ROUTES.branches, label: "Branches" },
  ];
  if (user) {
    items.push({ href: ROUTES.rentals, label: "My rentals" }, { href: ROUTES.profile, label: "Profile" });
    if (user.role === "admin") items.push({ href: ROUTES.admin, label: "Admin" });
  }
  return items;
}

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LogoutButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            setFailed(false);
            const { error } = await signOut();
            if (error) {
              setFailed(true);
              return;
            }
            onDone?.();
            router.push(ROUTES.home);
            router.refresh();
          })
        }
      >
        <LogOutIcon size={18} />
        {pending ? "Signing out…" : "Log out"}
      </button>
      {failed && (
        <span role="alert" className="text-sm text-red-700">
          Could not sign out. Try again.
        </span>
      )}
    </>
  );
}

function DesktopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="hidden items-center gap-1 lg:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                active ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              {item.href === ROUTES.admin && <ShieldIcon size={16} />}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MobileMenu({ items, user }: { items: NavItem[]; user: HeaderUser | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const panelId = useId();

  // Close the menu after navigation (state derived during render, no effect needed).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-surface-muted"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-surface shadow-raised"
      >
        <nav aria-label="Main" className="container-page py-3">
          <ul className="flex flex-col">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center rounded-lg px-3 text-base font-semibold",
                      active ? "bg-brand-50 text-brand-800" : "text-ink hover:bg-surface-muted",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 border-t border-line pt-3">
            {user ? (
              <div className="flex flex-col gap-2">
                <p className="px-3 text-sm text-ink-muted">
                  Signed in as <span className="font-semibold text-ink">{user.name || user.email}</span>
                </p>
                <LogoutButton className={buttonClasses("outline", "md", true)} onDone={() => setOpen(false)} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link href={ROUTES.login} className={buttonClasses("outline", "md", true)}>
                  Log in
                </Link>
                <Link href={ROUTES.register} className={buttonClasses("primary", "md", true)}>
                  Create account
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}

function AccountArea({ user }: { user: HeaderUser | null }) {
  if (!user) {
    return (
      <div className="hidden items-center gap-2 lg:flex">
        <Link href={ROUTES.login} className={buttonClasses("ghost", "sm")}>
          Log in
        </Link>
        <Link href={ROUTES.register} className={buttonClasses("primary", "sm")}>
          Create account
        </Link>
      </div>
    );
  }
  return (
    <div className="hidden items-center gap-3 lg:flex">
      <Link
        href={ROUTES.profile}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-brand-800" aria-hidden="true">
          <UserIcon size={16} />
        </span>
        <span className="max-w-40 truncate font-semibold text-ink">{user.name || user.email}</span>
      </Link>
      <LogoutButton className={buttonClasses("outline", "sm")} />
    </div>
  );
}

/** Sticky site header. Navigation and account actions depend on `user`. */
export function SiteHeader({ user, pending = false }: SiteHeaderProps) {
  const items = navItems(user);
  return (
    <header className="sticky top-0 z-40 border-b print:hidden border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="relative container-page flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Logo />
          {pending ? (
            <ul className="hidden items-center gap-1 lg:flex">
              <li>
                <Link href={ROUTES.search} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink">
                  Search cars
                </Link>
              </li>
            </ul>
          ) : (
            <nav aria-label="Main" className="hidden lg:block">
              <DesktopNav items={items} />
            </nav>
          )}
        </div>
        {pending ? (
          <div className="h-9 w-40 animate-shimmer rounded-lg bg-surface-muted" aria-hidden="true" />
        ) : (
          <>
            <AccountArea user={user} />
            <MobileMenu items={items} user={user} />
          </>
        )}
      </div>
    </header>
  );
}

