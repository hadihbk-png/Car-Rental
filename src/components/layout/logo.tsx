import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/** DriveEasy wordmark. The mark is an inline SVG so it never shifts layout. */
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 rounded-lg", className)} aria-label="DriveEasy home">
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="9" className={inverted ? "fill-white" : "fill-brand-700"} />
        <path
          d="M6.5 21V17l2.6-5.4c.3-.6.9-1 1.6-1h10.6c.7 0 1.3.4 1.6 1L25.5 17v4M6.5 17h19"
          fill="none"
          className={inverted ? "stroke-brand-800" : "stroke-white"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="11" cy="21" r="2" className={inverted ? "fill-accent-500" : "fill-accent-300"} />
        <circle cx="21" cy="21" r="2" className={inverted ? "fill-accent-500" : "fill-accent-300"} />
      </svg>
      <span className={cn("font-display text-lg font-extrabold tracking-tight", inverted ? "text-white" : "text-ink")}>
        Drive<span className={inverted ? "text-accent-300" : "text-brand-700"}>Easy</span>
      </span>
    </Link>
  );
}
