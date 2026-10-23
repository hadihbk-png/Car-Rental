import { io } from "next/cache";
import { Suspense } from "react";
import { listBranches } from "@/lib/fleet/catalog";
import { todayInTimeZone } from "@/lib/ui/datetime";
import { toBranchOption } from "@/app/_lib/trip";
import { SearchForm } from "@/components/search/search-form";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, CheckCircleIcon, KeyIcon, SearchIcon, ShieldIcon, TagIcon } from "@/components/ui/icons";

const benefits = [
  {
    icon: <TagIcon />,
    title: "The full price, up front",
    text: "Daily rate, extras, one-way fee, 5% VAT and the refundable deposit are all shown before you pay.",
  },
  {
    icon: <CalendarIcon />,
    title: "Real-time availability",
    text: "Every car has a live calendar, so the car you book is the car waiting for you.",
  },
  {
    icon: <ShieldIcon />,
    title: "Free cancellation",
    text: "Cancel for free up to 48 hours before pick-up. Change your dates online in a few taps.",
  },
];

const steps = [
  { icon: <SearchIcon />, title: "Search", text: "Choose a branch, dates and times." },
  { icon: <CheckCircleIcon />, title: "Book", text: "Pick a car and extras, add your licence and pay securely." },
  { icon: <KeyIcon />, title: "Drive", text: "Show the QR voucher at the counter and collect your keys." },
];

/** Branches and "today" are request-time data, so they stream in behind the static hero. */
async function HomeSearch() {
  await io();
  const branches = await listBranches();
  const minDate = branches[0] ? todayInTimeZone(new Date(), branches[0].timezone) : undefined;
  return <SearchForm branches={branches.map(toBranchOption)} minDate={minDate} />;
}

function SearchFormSkeleton() {
  return (
    <LoadingRegion label="Loading search form" className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-6 w-56" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[74px] w-full rounded-lg" />
        <Skeleton className="h-[74px] w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg md:w-48 md:self-end" />
    </LoadingRegion>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-brand-600),transparent_60%),radial-gradient(ellipse_at_bottom_left,var(--color-accent-700),transparent_55%)] opacity-60"
          aria-hidden="true"
        />
        <div className="relative container-page pt-12 pb-32 sm:pt-16 lg:pt-20 lg:pb-40">
          <p className="text-sm font-bold tracking-widest text-accent-300 uppercase">Car rental across the UAE</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold text-white sm:text-5xl lg:text-6xl">
            The right car, at the right price, ready when you land.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-brand-100">
            Compare cars at every DriveEasy branch, see the full price in AED and book in minutes.
          </p>
        </div>
      </section>

      <div className="relative container-page -mt-24 lg:-mt-28">
        <section aria-labelledby="search-heading" className="rounded-2xl border border-line bg-surface p-5 shadow-raised sm:p-8">
          <h2 id="search-heading" className="mb-5 text-xl font-bold text-ink">
            Find your car
          </h2>
          <Suspense fallback={<SearchFormSkeleton />}>
            <HomeSearch />
          </Suspense>
        </section>
      </div>

      <section aria-labelledby="benefits-heading" className="container-page py-16 sm:py-20">
        <h2 id="benefits-heading" className="text-2xl font-extrabold text-ink sm:text-3xl">
          Why drivers choose DriveEasy
        </h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {benefits.map((b) => (
            <li key={b.title} className="rounded-xl border border-line bg-surface p-6 shadow-card">
              <span className="flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">
                {b.icon}
              </span>
              <h3 className="mt-4 text-lg font-bold text-ink">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{b.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="border-t border-line bg-surface">
        <div className="container-page py-16 sm:py-20">
          <h2 id="how-heading" className="text-2xl font-extrabold text-ink sm:text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700 ring-1 ring-accent-200"
                  aria-hidden="true"
                >
                  {s.icon}
                </span>
                <div>
                  <h3 className="text-lg font-bold text-ink">
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
