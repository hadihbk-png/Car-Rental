import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { formatMoney } from "@/lib/ui/money";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { CarIcon, FuelIcon, GearIcon, LuggageIcon, SeatIcon } from "@/components/ui/icons";

export interface VehicleCardProps {
  /** e.g. "Toyota Camry" */
  name: string;
  /** Model year or trim shown after the name, optional. */
  subtitle?: string;
  category: string;
  /** Public photo URL (same-origin /api/files/public/... or configured remote). Null shows an illustration. */
  imageUrl: string | null;
  imageAlt?: string;
  transmission: string;
  seats: number;
  fuelType: string;
  luggage?: number;
  /** Server-quoted daily rate in fils. */
  dailyRateFils: number;
  /** Server-quoted total for the chosen dates (before extras), in fils. */
  totalFils?: number;
  days?: number;
  href: string;
  /** Call-to-action label (default "View deal"). */
  ctaLabel?: string;
  /** False greys the card and shows "Not available for these dates". */
  available?: boolean;
  /** Small highlight tags, e.g. ["Free cancellation"]. */
  tags?: readonly string[];
  /** Load the image eagerly (first row of results). */
  preloadImage?: boolean;
  headingLevel?: 2 | 3;
  /** Extra content under the specs (e.g. pick-up branch). */
  footnote?: ReactNode;
}

function Spec({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="text-ink-subtle" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  );
}

export function VehicleCard({
  name,
  subtitle,
  category,
  imageUrl,
  imageAlt,
  transmission,
  seats,
  fuelType,
  luggage,
  dailyRateFils,
  totalFils,
  days,
  href,
  ctaLabel = "View deal",
  available = true,
  tags = [],
  preloadImage = false,
  headingLevel = 2,
  footnote,
}: VehicleCardProps) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article
      className={cn(
        "group relative flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-shadow",
        available ? "hover:shadow-raised" : "opacity-75",
      )}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-brand-50 to-surface-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt ?? `${name}, ${category}`}
            fill
            sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            preload={preloadImage}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-brand-300" role="img" aria-label={`No photo of ${name}`}>
            <CarIcon size={72} strokeWidth={1.2} />
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <Badge tone="neutral" className="bg-white/95">
            {category}
          </Badge>
          {tags.map((t) => (
            <Badge key={t} tone="success" className="bg-white/95">
              {t}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <H className="text-lg font-bold text-ink">
          {/* The whole card is clickable via the stretched link; the CTA below is a visual duplicate. */}
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {name}
          </Link>
          {subtitle && <span className="ml-1.5 text-sm font-medium text-ink-muted">{subtitle}</span>}
        </H>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted" aria-label="Specifications">
          <Spec icon={<SeatIcon size={16} />}>{seats} seats</Spec>
          <Spec icon={<GearIcon size={16} />}>{transmission}</Spec>
          <Spec icon={<FuelIcon size={16} />}>{fuelType}</Spec>
          {luggage !== undefined && <Spec icon={<LuggageIcon size={16} />}>{luggage} bags</Spec>}
        </ul>
        {footnote && <div className="mt-2 text-sm text-ink-muted">{footnote}</div>}

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-4">
          {available ? (
            <div>
              <p className="text-xl font-extrabold text-ink tabular">
                {formatMoney(dailyRateFils, "AED")}
                <span className="text-sm font-medium text-ink-muted"> / day</span>
              </p>
              {totalFils !== undefined && days !== undefined && (
                <p className="text-sm text-ink-muted tabular">
                  {formatMoney(totalFils, "AED")} total for {days} {days === 1 ? "day" : "days"}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm font-semibold text-red-800">Not available for these dates</p>
          )}
          <span
            className={cn(buttonClasses(available ? "primary" : "outline", "md"), "pointer-events-none")}
            aria-hidden="true"
          >
            {available ? ctaLabel : "See calendar"}
          </span>
        </div>
      </div>
      {/* Focus ring for the stretched link, drawn on the card. */}
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-brand-700 ring-offset-2 group-has-[a:focus-visible]:ring-3" aria-hidden="true" />
    </article>
  );
}
