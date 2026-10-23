import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { listMyReservations, type ReservationView } from "@/lib/reservations";
import { formatDateTime } from "@/lib/ui/datetime";
import { formatMoney } from "@/lib/ui/money";
import { ROUTES } from "@/lib/ui/routes";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CarIcon, CalendarIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "My rentals" };

const ACTIVE = new Set(["PENDING", "CONFIRMED", "PICKED_UP"]);

function RentalRow({ r }: { r: ReservationView }) {
  const photo = r.vehicle.photoUrls[0];
  return (
    <li className="relative flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center">
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-lg bg-surface-muted sm:h-20 sm:w-32">
        {photo ? <Image src={photo} alt="" fill sizes="(min-width: 640px) 128px, 100vw" className="object-cover" /> : <CarIcon className="m-auto h-full text-brand-300" size={40} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-ink">
            <Link href={`/rentals/${r.reference}`} className="after:absolute after:inset-0 hover:underline">
              {r.vehicle.name}
            </Link>
          </h3>
          <StatusBadge kind="reservation" status={r.status} />
        </div>
        <p className="mt-0.5 font-mono text-sm text-ink-muted">{r.reference}</p>
        <p className="mt-1 text-sm text-ink">
          {formatDateTime(r.pickupAt, r.timezone)} → {formatDateTime(r.returnAt, r.returnBranch.timezone)}
        </p>
        <p className="text-sm text-ink-muted">
          {r.pickupBranch.name}
          {r.returnBranch.id !== r.pickupBranch.id && ` → ${r.returnBranch.name}`}
        </p>
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
        <p className="text-lg font-extrabold text-ink tabular">{formatMoney(r.price.totalFils, "AED")}</p>
        {r.can.pay && (
          <Link href={`/book/pay/${r.reference}`} className={buttonClasses("primary", "sm")}>
            Complete payment
          </Link>
        )}
        {r.can.payBalance && (
          <Link href={`/rentals/${r.reference}`} className={buttonClasses("accent", "sm")}>
            Pay balance {formatMoney(r.balanceDueFils, "AED")}
          </Link>
        )}
        {r.can.viewVoucher && (
          <Link href={`/rentals/${r.reference}/voucher`} className={buttonClasses("outline", "sm")}>
            Voucher
          </Link>
        )}
      </div>
    </li>
  );
}

export default async function RentalsPage() {
  const actor = await requireUserOrRedirect(ROUTES.rentals);
  const all = await listMyReservations(actor);
  const upcoming = all.filter((r) => ACTIVE.has(r.status) && (r.status !== "PENDING" || r.can.pay || r.paymentStatus === "pending"));
  const past = all.filter((r) => !upcoming.includes(r));

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        title="My rentals"
        description="View, change or cancel your reservations, and open your pick-up vouchers."
        actions={
          <Link href={ROUTES.search} className={buttonClasses("primary")}>
            Book a car
          </Link>
        }
      />
      {all.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="No rentals yet"
          description="When you book a car, your reservation and pick-up voucher will appear here."
          actions={
            <Link href={ROUTES.search} className={buttonClasses("primary")}>
              Find a car
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          <section aria-labelledby="upcoming-heading">
            <h2 id="upcoming-heading" className="mb-4 text-xl font-bold text-ink">
              Upcoming and active
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState variant="plain" headingLevel={3} title="Nothing coming up" description="You have no upcoming rentals." className="rounded-xl border border-dashed border-line-strong bg-surface py-8" />
            ) : (
              <ul className="flex flex-col gap-3">
                {upcoming.map((r) => (
                  <RentalRow key={r.id} r={r} />
                ))}
              </ul>
            )}
          </section>
          {past.length > 0 && (
            <section aria-labelledby="past-heading">
              <h2 id="past-heading" className="mb-4 text-xl font-bold text-ink">
                Past and cancelled
              </h2>
              <ul className="flex flex-col gap-3">
                {past.map((r) => (
                  <RentalRow key={r.id} r={r} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
