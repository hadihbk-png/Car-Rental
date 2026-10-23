import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { isDomainError } from "@/lib/errors";
import { getReservation, type ReservationView } from "@/lib/reservations";
import { activePaymentProvider } from "@/app/_lib/payment-provider";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { Stepper } from "@/components/booking/stepper";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TripSummary } from "../../_components/trip-summary";
import { AutoRefresh } from "./auto-refresh";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Payment" };

async function load(reference: string): Promise<ReservationView> {
  const actor = await requireUserOrRedirect(`/book/pay/${encodeURIComponent(reference)}`);
  try {
    return await getReservation(actor, reference);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export default async function PayPage({ params }: PageProps<"/book/pay/[reference]">) {
  const { reference } = await params;
  const r = await load(reference);
  if (["CONFIRMED", "PICKED_UP", "RETURNED"].includes(r.status)) redirect(`/rentals/${r.reference}/voucher`);

  const restartHref = `/vehicles/${r.vehicle.id}`;
  const awaitingConfirmation = r.status === "PENDING" && r.paymentStatus === "pending";
  const driverHref = "/profile";

  return (
    <div className="container-page py-8 sm:py-10">
      <Stepper current="payment" className="mb-8" />
      <PageHeader eyebrow={`Reservation ${r.reference}`} title="Payment" description="Pay securely to confirm your reservation." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {awaitingConfirmation ? (
            <Card padded>
              <AutoRefresh />
              <div className="flex items-start gap-4" role="status">
                <Spinner className="mt-1 text-brand-700" />
                <div>
                  <h2 className="text-lg font-bold text-ink">Awaiting payment confirmation</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Your bank is confirming the payment. This page updates automatically; you&apos;ll see your voucher as soon as it&apos;s
                    confirmed. You don&apos;t need to pay again.
                  </p>
                </div>
              </div>
            </Card>
          ) : r.can.pay && r.holdExpiresAt ? (
            <>
              <HoldCountdown expiresAt={r.holdExpiresAt.toISOString()} />
              <Card as="section" aria-labelledby="pay-heading" padded>
                <h2 id="pay-heading" className="mb-4 text-lg font-bold text-ink">
                  Payment details
                </h2>
                <PaymentForm
                  reservationId={r.id}
                  provider={activePaymentProvider()}
                  initialKey={`pay_${randomUUID()}`}
                  totalFils={r.price.totalFils}
                  depositFils={r.price.depositFils}
                  driverHref={driverHref}
                />
              </Card>
            </>
          ) : (
            <Notice
              tone="warning"
              title={r.status === "EXPIRED" ? "Your hold has expired" : "This reservation can't be paid"}
              actions={
                <>
                  <Link href={restartHref} className={buttonClasses("primary", "sm")}>
                    Book this car again
                  </Link>
                  <Link href="/rentals" className={buttonClasses("outline", "sm")}>
                    My rentals
                  </Link>
                </>
              }
            >
              {r.status === "EXPIRED"
                ? "We held the car for 15 minutes but payment wasn't completed, so the hold was released. Nothing was charged."
                : `Status: ${r.status.toLowerCase().replace(/_/g, " ")}.`}
            </Notice>
          )}
        </div>

        <div className="lg:sticky lg:top-20">
          <TripSummary
            vehicle={r.vehicle}
            pickupBranchName={r.pickupBranch.name}
            returnBranchName={r.returnBranch.name}
            pickupAt={r.pickupAt}
            returnAt={r.returnAt}
            timeZone={r.timezone}
            returnTimeZone={r.returnBranch.timezone}
            price={r.price}
          />
        </div>
      </div>
    </div>
  );
}
