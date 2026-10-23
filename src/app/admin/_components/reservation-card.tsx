import Link from "next/link";
import type { ReservationView } from "@/lib/reservations";
import { formatDateTime } from "@/lib/ui/datetime";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/** Compact reservation summary for the check-out / check-in desks. */
export function ReservationCard({ r }: { r: ReservationView }) {
  return (
    <Card padded>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/reservations/${r.reference}`} className="font-mono text-lg font-bold text-brand-800 hover:underline">
          {r.reference}
        </Link>
        <StatusBadge kind="reservation" status={r.status} />
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Customer</dt>
          <dd className="font-semibold text-ink">{r.customer.name}</dd>
          <dd className="break-all text-ink-muted">{r.customer.email}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Vehicle</dt>
          <dd className="font-semibold text-ink">{r.vehicle.name}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Pick-up</dt>
          <dd className="font-semibold text-ink">{formatDateTime(r.pickupAt, r.timezone)}</dd>
          <dd className="text-ink-muted">{r.pickupBranch.name}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Return</dt>
          <dd className="font-semibold text-ink">{formatDateTime(r.returnAt, r.returnBranch.timezone)}</dd>
          <dd className="text-ink-muted">{r.returnBranch.name}</dd>
        </div>
      </dl>
    </Card>
  );
}

export const FUEL_OPTIONS_EIGHTHS = Array.from({ length: 9 }, (_, i) => ({
  value: String(8 - i),
  label: 8 - i === 8 ? "8/8 (full)" : 8 - i === 0 ? "0/8 (empty)" : `${8 - i}/8`,
}));
