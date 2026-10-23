import type { ReactNode } from "react";
import { CheckCircleIcon } from "@/components/ui/icons";

const points = [
  "Prices in AED with VAT and deposit shown before you pay",
  "Free cancellation up to 48 hours before pick-up",
  "Digital pick-up voucher with QR code",
];

/** Shared frame for log in / create account. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container-page grid flex-1 items-start gap-10 py-10 sm:py-16 lg:grid-cols-2 lg:items-center">
      <section className="hidden lg:block" aria-label="Why DriveEasy">
        <p className="text-sm font-bold tracking-widest text-brand-700 uppercase">DriveEasy</p>
        <h2 className="mt-2 text-4xl font-extrabold text-ink">Your next drive across the Emirates starts here.</h2>
        <ul className="mt-8 flex flex-col gap-4">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-base text-ink-muted">
              <CheckCircleIcon className="mt-0.5 shrink-0 text-brand-700" />
              {p}
            </li>
          ))}
        </ul>
      </section>
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}
