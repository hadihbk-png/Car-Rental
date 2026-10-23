import QRCode from "qrcode";
import { cn } from "@/lib/ui/cn";

export interface QrCodeProps {
  /** The (signed) payload to encode. Produced by the server; never raw ids. */
  value: string;
  /** Accessible description, e.g. "Pick-up QR code for reservation DE-7K3M9Q". */
  label: string;
  /** Rendered size in CSS pixels (square). */
  size?: number;
  /** Human-readable code printed under the QR for staff to type if scanning fails. */
  caption?: string;
  className?: string;
}

/**
 * Server component: renders the QR as inline SVG (crisp at any zoom, prints well, no client JS).
 * High error correction so it still scans from a cracked phone screen.
 */
export async function QrCode({ value, label, size = 200, caption, className }: QrCodeProps) {
  const svg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 1,
    color: { dark: "#0f1c24", light: "#ffffff" },
  });
  return (
    <figure className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div
        role="img"
        aria-label={label}
        className="rounded-xl bg-white p-3 ring-1 ring-line [&>svg]:h-full [&>svg]:w-full"
        style={{ width: size, height: size }}
        // Generated locally by the qrcode library from `value`; contains no user HTML.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {caption && <figcaption className="font-mono text-lg font-bold tracking-[0.2em] text-ink">{caption}</figcaption>}
    </figure>
  );
}
