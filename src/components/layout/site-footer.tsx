import Link from "next/link";
import { ROUTES } from "@/lib/ui/routes";
import { Logo } from "./logo";

const columns = [
  {
    title: "Rent",
    links: [
      { href: ROUTES.search, label: "Search cars" },
      { href: ROUTES.branches, label: "Branches" },
      { href: ROUTES.rentals, label: "My rentals" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: ROUTES.profile, label: "Profile & licence" },
      { href: ROUTES.login, label: "Log in" },
      { href: ROUTES.register, label: "Create account" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t print:hidden border-brand-900 bg-brand-950 text-brand-100">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Logo inverted />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-brand-200">
            Car rental across the UAE with clear prices in AED, VAT shown up front and a refundable deposit released after
            return.
          </p>
          <ul className="mt-4 flex flex-col gap-1 text-sm text-brand-200">
            <li>Free cancellation up to 48 hours before pick-up.</li>
            <li>All times are shown in the branch&apos;s local time.</li>
          </ul>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-bold tracking-wide text-white uppercase">{col.title}</h2>
            <ul className="mt-3 flex flex-col gap-1">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="inline-flex min-h-10 items-center rounded text-sm text-brand-100 hover:text-white hover:underline focus-visible:outline-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className="container-page py-5 text-xs text-brand-200">DriveEasy · Prices in UAE dirhams (AED) and include 5% VAT where shown.</p>
      </div>
    </footer>
  );
}
